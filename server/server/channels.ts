import { TextLineStream, writeAll } from 'https://deno.land/std@0.188.0/streams/mod.ts'
import { documentChanged, openDocSingleton, DocumentSavable } from './json.ts'
import { canUserInContext, setPermissionOnObject } from './roles.ts'
import { type VoiceState, type Channel, MessageToSFU, sfuToServer, MessageFromSFU, RolePermissionState } from './schema.ts'
import { randomString } from './auth.ts'
import { EpisodicStore, globalChange, insertUpdate, redactUpdate } from './versioned.ts'
import config from './config.ts'
import { getLog } from './log.ts'

const { info, error } = getLog('channels')

// TODO: Maybe we can move activeChannel to its own file someday?

export let activeChannels: EpisodicStore<ActiveChannel, 'channelID'> = {
    idKey: 'channelID',
    startIndex: 0,
    length: 0,
    data: []
}
let channelToIndex: Map<number, number> = new Map()

function modifyActiveChannel(channel: ActiveChannel) {
    insertUpdate(activeChannels, channelToIndex, channel)
    globalChange()
}

let clientMessageCallback = (_: number, _2: number, _3: MessageFromSFU) => {}
export function setClientMessageCallback(cb: (channel_id: number, peer_id: number, message: MessageFromSFU) => void) {
    clientMessageCallback = cb
}

interface LoadingMediaWorker {
    code: string|undefined
    open: boolean
    process: Deno.Process
    ws?: WebSocket
    unix?: Deno.Conn

    index: number
    promise: Promise<void>
    resolve: () => void
}
const mediaWorkers = new Array<LoadingMediaWorker>()

async function startUnixSocketReader(lines: AsyncIterableIterator<string>) {
    for await (const line of lines) {
        const unparsed = JSON.parse(line)
        const msg = sfuToServer.parse(unparsed)
        info('unix socket:', msg)
        clientMessageCallback(msg[0], msg[1], msg[2])
    }
}

let unixSocketStarted = false
async function startUnixSocket() {
    info('starting domain socket:', config.mediaWorker.domainSocket)
    for await (const connection of Deno.listen({
        transport: 'unix',
        path: config.mediaWorker.domainSocket,
    })) {
        const lines = connection.readable.pipeThrough(new TextDecoderStream())
                                         .pipeThrough(new TextLineStream())
        let foundWorker: LoadingMediaWorker|undefined = undefined
        const linesIter = lines[Symbol.asyncIterator]()
        while(true) {
            const line = await linesIter.next()
            if (line.done) {
                break
            }
            const message = JSON.parse(line.value)
            const id = message.id
            const code = message.code
            if (typeof id !== 'number' ||
                typeof code !== 'string') {
                error('sfu unix socket must authenticate')
                continue
            }

            const worker = mediaWorkers[id]
            if (worker === undefined) {
                continue
            }
            if (worker.code !== code || worker.code === undefined) {
                error('failed sfu unix socket authentication')
                continue
            }
            foundWorker = worker
            break
        }
        if (foundWorker === undefined) {
            break
        }
        foundWorker.unix = connection
        foundWorker.open = true
        foundWorker.resolve()
        startUnixSocketReader(linesIter)
    }
}

export function mediaWorkerConnected(ws: WebSocket, index: number, code: String) {
    const loading = mediaWorkers[index]
    if (loading === undefined || loading.code === undefined || loading.code !== code) {
        error('failed sfu ws authentication')
        return
    }

    loading.code = undefined
    ws.addEventListener('message', function (event) {
        if (event.data === 'heartbeat') {
            info('heartbeat received')
            return
        }
        const msg = sfuToServer.parse(JSON.parse(event.data))
        info('websocket:', msg)
        clientMessageCallback(msg[0], msg[1], msg[2])
    })
    ws.addEventListener('close', function () {
        loading.open = false
        error('mediaWorker lost connection unexpectedly')
    })
    ws.addEventListener('open', function () {
        info('media worker connected via websocket')
        loading.ws = ws
        loading.open = true
        loading.resolve()
    })
}

function controllerURL(id: number, code: string) {
    if (!config.httpPort) {
        if (config.mediaWorker.domainSocket) {
            return ''
        }
        throw 'config error, either http or unix sockets must be configured for the SFU'
    }
    return `ws://localhost:${config.httpPort}/media-worker/${id}/${code}`
}

let msWorkerIndex = 0
function getMediaWorker(): LoadingMediaWorker {
    if (mediaWorkers.length < config.mediaWorker.workerCount) {
        const code = randomString()
        const index = mediaWorkers.length
        //info('media-worker', index, 'path', config.mediaWorker.path, code)

        if (config.mediaWorker.domainSocket
            && !unixSocketStarted
            && Deno.build.os !== 'windows') {
            startUnixSocket()
            unixSocketStarted = true
        }

        const announceIP = config.mediaWorker.announceIP

        // TODO: validate ipv4/ipv6.
        if (announceIP === '' || announceIP === '0.0.0.0' || announceIP === '127.0.0.1') {
            throw 'server has configured a bad announce IP for the SFU'
        }

        const process = Deno.run({
            cmd: [config.mediaWorker.path],
            env: {
                // TODO: We do not currently send mediasoup.worker.codecs? Do we still want to have it as a configurable variable?
                'SFU_WORKER_ID': `${index}`,
                'SFU_WORKER_CODE': code,
                'SFU_CONTROLLER_SOCKET': config.mediaWorker.domainSocket,
                'SFU_CONTROLLER_URL': controllerURL(index, code),
                'SFU_RTC_MIN_PORT': `${config.mediaWorker.worker.rtcMinPort}`,
                'SFU_RTC_MAX_PORT': `${config.mediaWorker.worker.rtcMaxPort}`,
                'SFU_LOG_LEVEL': config.mediaWorker.worker.logLevel,
                'SFU_LOG_TAGS': config.mediaWorker.worker.logTags.join(';'),
                'SFU_LISTEN_IP': '0.0.0.0', // TODO: make configurable
                'SFU_ANNOUNCE_IP': announceIP,
            },
        })

        let resolve: () => void = () => {}
        const promise = new Promise<void>(cb => resolve = cb)
        const load: LoadingMediaWorker = {
            code,
            open: false,
            process,
            promise,
            resolve,
            ws: undefined,
            unix: undefined,
            index: mediaWorkers.length,
        }
        mediaWorkers.push(load)

        return load

        // TODO: Handle the process dying
    } else {
        return mediaWorkers[msWorkerIndex++ % config.mediaWorker.workerCount]!
    }
}

async function sendMediaMessage(workerIndex: number, message: any) { // TODO: Use schema
    const worker = mediaWorkers[workerIndex]!
    const asJSON = `${JSON.stringify(message)}\n`
    if (!worker.open) {
        await worker.promise
    }
    if (worker.unix) {
        const buffer = new TextEncoder().encode(asJSON)
        await writeAll(worker.unix, buffer);
    } else if (worker.ws) {
        worker.ws.send(asJSON)
    }
}

const defaultChannels = {
    nextID: 0,
    list: [] as Channel[]
}
export type StoredChannels = typeof defaultChannels

let channels: StoredChannels
export let channelsSavable: DocumentSavable<StoredChannels>

interface ActiveChannel {
    workerIndex: number,
    channelID: number,
    connectedUsers: VoiceState[]
}

/** The difference between this procedure and getActiveChannel is that
 * maybeActiveChannel will return undefined if not found while the other
 * procedure will instead create a new ActiveChannel.
 */
function maybeActiveChannel(channelID: number): ActiveChannel|undefined {
    const activeChannelIndex = channelToIndex.get(channelID)
    if (activeChannelIndex !== undefined) {
        return activeChannels.data[activeChannelIndex]
    } else {
        return undefined
    }
}

function getActiveChannel(channelID: number): ActiveChannel {
    const current = maybeActiveChannel(channelID)
    if (current !== undefined) {
        return current
    }
    const worker = getMediaWorker()

    let channel: ActiveChannel = {
        workerIndex: worker.index,
        channelID,
        connectedUsers: []
    }
    modifyActiveChannel(channel)

    worker.promise.then(() => {
        sendMediaMessage(worker.index, {
            type: 'NewChannel',
            codecs: config.mediaWorker.router.mediaCodecs,
            channel: channelID,
        })
    })

    return channel
}

export function sendMessageSFU(voiceState: VoiceState, message: MessageToSFU): Promise<void>|void {
    const activeChannel = maybeActiveChannel(voiceState.channelID)
    if (activeChannel !== undefined) {
        return sendMediaMessage(activeChannel.workerIndex, {
            type: 'HandleClient',
            channel: activeChannel.channelID,
            peer: voiceState.peerID,
            message,
        })
    }
}

/** Synchronizes VoiceState with both clients and media workers. */
async function synchronizeVoiceState(voiceState: VoiceState, rtcDeafen: boolean) {
    const activeChannel = maybeActiveChannel(voiceState.channelID)
    if (activeChannel === undefined) {
        return
    }

    if (rtcDeafen) {
        await sendMediaMessage(activeChannel.workerIndex, {
            type: 'SetDeafenPeer',
            channel: activeChannel.channelID,
            peer: voiceState.peerID,
            deafen: voiceState.selfDeafen,
        })
    }

    modifyActiveChannel(activeChannel)
}

async function moveChannel(voiceState: VoiceState, channelID: number) {
    const oldActiveChannel = maybeActiveChannel(voiceState.channelID)
    if (oldActiveChannel !== undefined) {
        info(voiceState.userID, 'disconnect from:', oldActiveChannel.channelID)
        oldActiveChannel.connectedUsers =
            oldActiveChannel.connectedUsers.filter(v => v != voiceState)

        await sendMediaMessage(oldActiveChannel.workerIndex, {
            type: 'RemovePeer',
            channel: oldActiveChannel.channelID,
            peer: voiceState.peerID,
        })

        modifyActiveChannel(oldActiveChannel)
    }
    info(voiceState.userID, 'move to channel', channelID)
    voiceState.channelID = channelID
    if (channelID !== -1) {
        const activeChannel = getActiveChannel(channelID)
        const channel = findChannel(channelID)
        if (channel === undefined) {
            documentChanged(channelsSavable)
            throw 'invalid channel'
        }
        activeChannel.connectedUsers.push(voiceState)
        await sendMediaMessage(activeChannel.workerIndex, {
            type: 'AddPeer',
            channel: channelID,
            peer: voiceState.peerID,
        })
        modifyActiveChannel(activeChannel)
    }
    synchronizeVoiceState(voiceState, true)
}

export function joinChannel(voiceState: VoiceState, channelID: number) {
    if (channelID === voiceState.channelID) {
        throw 'server should not allow rejoining the same channel'
    }
    moveChannel(voiceState, channelID)
}


function findChannel(channelID: number) {
    for(const channel of channels.list) {
        if (channel.channelID === channelID) {
            return channel
        }
    }
    return undefined
}


export function setVoiceTalking(state: VoiceState, talking: boolean) {
    state.talking = talking
    if (state.selfMute) {
        return
    }
    synchronizeVoiceState(state, false)
}

export function setVoiceSelfMute(state: VoiceState, mute: boolean, talking: boolean) {
    state.selfMute = mute
    state.talking = !mute && talking
    synchronizeVoiceState(state, false)
}

export function setVoiceSelfDeafen(state: VoiceState, deafen: boolean) {
    state.selfDeafen = deafen
    synchronizeVoiceState(state, true)
}

export function createChannel() {
    channels.list.push({
        name: 'unnamed-channel',
        channelID: channels.nextID++,
    })
    documentChanged(channelsSavable)
}

export function deleteChannel(channelID: number) {
    const activeChannel = maybeActiveChannel(channelID)
    if (activeChannel !== undefined) {
        for(const user of activeChannel.connectedUsers) {
            moveChannel(user, -1)
        }

        redactUpdate(activeChannels, channelToIndex, channelID)
        // globalChange() should be called but is called later on in function, so it is fine.
    }
    channels.list = channels.list.filter(c => c.channelID !== channelID)
    documentChanged(channelsSavable)
}

export function deleteChannelPermissions(channelID: number) {
    for(const channel of channels.list) {
        if (channel.channelID === channelID) {
            channel.permissions = undefined
            documentChanged(channelsSavable)
        }
    }
}

export function setChannelRolePermission(channelID: number, roleID: number, permission: string, state: RolePermissionState) {
    for(const channel of channels.list) {
        if (channel.channelID !== channelID) {
            continue
        }
        channel.permissions ||= []
        let role = channel.permissions.find((r: any) => r.roleID == roleID)
        if (!role) {
            role = { roleID }
            channel.permissions.push(role)
        }

        setPermissionOnObject(role, permission, state)

        documentChanged(channelsSavable)
    }
}

export function setChannelName(channelID: number, name: string) {
    for (const channel of channels.list) {
        if (channel.channelID === channelID) {
            channel.name = name
            documentChanged(channelsSavable)
            break
        }
    }
}

export function canUserInChannel(permission: string, userID: string, channelID: number) {
    if (channelID === -1) {
        return true
    }
    const channel = findChannel(channelID)
    if (channel === undefined) {
        throw 'invalid channel'
    }
    return canUserInContext(permission, userID, undefined, channel.permissions)
}

export async function loadData() {
    const container = openDocSingleton('channels', defaultChannels)
    const entry = await container.open()
    channels = entry.data
    channelsSavable = [container, entry]
    documentChanged(channelsSavable)
}
