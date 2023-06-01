import { MESSAGE_TOKENS, FLAG_BOLD, FLAG_ITALIC, FLAG_STRIKE, FLAG_UNDERLINE, FLAG_NEWLINE, FLAG_LINK } from './message_format'
import { strftime } from './strftime'
import { savePersistent, loadPersistent, loadStates, LoadProgress } from './db' 
import { AudioLevels, defaultVoiceConfig } from './voice_config'
import { AttachmentType, modifyServer, mainStore, defaultServer, defaultRoom, defaultMiscConfig, toggleCentralAutoUpdate, setVoice, setMiscConfig, NavigationLocation, Toast } from './store'
import type { ParsedMessage, UnsentMessage, MainStore, ClientUser, ConnectivityInfo, Server } from './store'
import type { Immutable, AlmostImmutable } from './immutable'
import { verifyX509Chain, importPKCS8PEM } from './user_chains'
import { ensurePrivateMatchesPublicKey, exportAsSHA512, loadCertificatesFromMultiplePEM } from './x509_chains'
import { getNewestProfileVersion, getProfile } from './profiles'
import type { ActiveChannel, Message, ServerUser, UpdateObjectVariants } from './schema'
import { safeURL } from './join_url'

// TODO: This file will eventually contain all the createAction() calls 

function parseMessage(msg: Message, messageTimeFormat: string, user?: Immutable<ServerUser>): ParsedMessage {
    if (msg.deleted) {
        return {
            deleted: true,
        }
    }

    let current = { flags: 0, text: '' }
    const components = [current]
    if (typeof msg.content === 'string') {
        const words = msg.content.split(MESSAGE_TOKENS)
        for (let i = 0; i < words.length; i++) {
            const word = words[i]
            if (word === '**') {
                current = { flags: current.flags, text: '' }
                components.push(current)
                current.flags ^= FLAG_BOLD
            } else if (word === '__') {
                current = { flags: current.flags, text: '' }
                components.push(current)
                current.flags ^= FLAG_UNDERLINE
            } else if (word === '~~') {
                current = { flags: current.flags, text: '' }
                components.push(current)
                current.flags ^= FLAG_STRIKE
            } else if (word === '//') {
                current = { flags: current.flags, text: '' }
                components.push(current)
                current.flags ^= FLAG_ITALIC
            } else if (word === '\\__') {
                current.text += '__'
            } else if (word === '\\**') {
                current.text += '**'
            } else if (word === '\\~~') {
                current.text += '~~'
            } else if (word === '\\//') {
                current.text += '//'
            } else if (word === '\n') {
                components.push({ flags: FLAG_NEWLINE, text: '' })
                current = { flags: current.flags, text: '' }
                components.push(current)
            } else if ((word === 'https' || word === 'http') && words[i+1] === '://') {
                components.push({
                    flags: current.flags | FLAG_LINK,
                    text: word + words[i+1] + words[i+2],
                })
                current = { flags: current.flags, text: '' }
                components.push(current)
                i += 2
            } else {
                current.text += word
            }
        }
    }

    const date = new Date(msg.time * 1000)

    let attachmentType = AttachmentType.None
    if (msg.attachment) {
        const attachment = msg.attachment
        if (attachment.mime.startsWith('image/')) {
            attachmentType = AttachmentType.Image
        } else if (attachment.mime === 'video/quicktime') {
            attachmentType = AttachmentType.File
        } else if (attachment.mime.startsWith('video/')) {
            attachmentType = AttachmentType.Video
        } else if (attachment.mime.startsWith('audio/')) {
            attachmentType = AttachmentType.Audio
        } else {
            attachmentType = AttachmentType.File
        }
    }

    return {
        msg,

        // TODO: This should probably be moved, or?
        time: strftime(messageTimeFormat, date),
        attachmentType,
        profileTimestamp: user ? user.profileTimestamp : 0,
        deleted: false,
        components: components.filter((c) => c.text.length > 0 || c.flags === FLAG_NEWLINE),
    }
}

function parsePath(txt?: string): string[] {
    return txt === undefined ? [] : txt.split('.')
}

function maybeUpdate<O, K extends keyof O>(old: Immutable<O>, n: AlmostImmutable<O>, k: K, defaultValue: O[K]): AlmostImmutable<O[K]> {
    const nk = n[k]
    if (nk === old[k]) {
        if (nk === undefined) {
            const a = {...defaultValue}
            n[k] = a
            return a
        } else {
            const a = {...old[k]}
            n[k] = a
            return a
        }
    } else {
        return nk || {...defaultValue}
    }
}

function ingestUserUpdate(newServer: AlmostImmutable<Server>, users: ServerUser[], newVersion: number) {
    if (users.length === 0) {
        newServer.usersVersion = newVersion
        return
    }

    const newUsers = {...newServer.users}
    for (const user of users) {
        newUsers[user.userID] = user

        if (user.userID === newServer.connectivityInfo.userID) {
            const current = getNewestProfileVersion(user.userID)
            if (current < user.profileTimestamp) {
                const embedURL = safeURL(newServer.profilesURL)
                getProfile(embedURL,
                           user.userID,
                           user.profileTimestamp).then(p => {
                    // Memory leak here on purpose. We should probably decr somewhere
                    // TODO: A better method would be for the sweeper to have a whitelist of userIDs
                    p.references++
                }).catch(e => {
                    console.error('while loading', user.userID, e)
                })
            } else if (current > user.profileTimestamp) {
                // TODO: Send a newer profile to the server!
            }
        }
    }
    newServer.usersVersion = newVersion
    newServer.users = newUsers
}

function ingestActiveChannelsUpdate(newServer: AlmostImmutable<Server>, activeChannels: ActiveChannel[], newVersion: number) {
    if (activeChannels.length === 0) {
        newServer.activeChannelsVersion = newVersion
        return
    }
    const newActiveChannels = {...newServer.activeChannels}
    for (const activeChannel of activeChannels) {
        newActiveChannels[activeChannel.channelID] = activeChannel
    }

    newServer.activeChannelsVersion = newVersion
    newServer.activeChannels = newActiveChannels
}

export const ingestUpdates = mainStore.createAction('ingestUpdates', (store, serverID: number, updates: UpdateObjectVariants[]) => {
    const newStore: AlmostImmutable<MainStore> = { ...store }
    const server = store.servers[serverID]
    if (server === undefined) {
        return store
    }

    const newServer: AlmostImmutable<Server> = {...server, forcedUpdateAttempts: server.forcedUpdateAttempts + 1}

    newStore.servers = {
        ...newStore.servers,
        [serverID]: newServer
    }

    function parse(m: Message) {
        const user = newServer.users[m.userID]
        return parseMessage(m, store.miscConfig.messageTimeFormat, user)
    }

    //console.dir(updates)
    //debugger;

    for(const update of updates) {
        // TODO: Should a switch count as one or two levels of indent? We might be over 3

        switch (update.type) {
            case 'chunk': {
                const [_, txtRoomID, txtChunkIndex] = parsePath(update.path)
                const roomID = parseInt(txtRoomID || '')
                const chunkIndex = parseInt(txtChunkIndex || '')
                const rooms = maybeUpdate(server, newServer, 'rooms', {})
                const room = maybeUpdate(server.rooms, rooms, roomID, defaultRoom)
                const chunks = maybeUpdate(server.rooms[roomID]||defaultRoom, room, 'chunks', {})
                chunks[chunkIndex] = {
                    version: update.version,
                    messages: update.data.messages.map(parse),
                }
                break
            }
            case 'room': {
                const [_, txtRoomID] = parsePath(update.path)
                const roomID = parseInt(txtRoomID || '')
                const rooms = maybeUpdate(server, newServer, 'rooms', {})
                const currentRoom = rooms[roomID] || defaultRoom
                rooms[roomID] = {
                    ...currentRoom,
                    ...update.data,
                    version: update.version
                }
                break
            }
            case 'rooms': {
                newServer.roomList = update.data
                newServer.roomListVersion = update.version
                break
            }
            case 'channels': {
                newServer.channels = update.data
                newServer.channelsVersion = update.version
                break
            }
            case 'activeChannels': {
                ingestActiveChannelsUpdate(newServer, update.data, update.version)
                break
            }
            case 'users': {
                ingestUserUpdate(newServer, update.data, update.version)
                break
            }
            case 'userRoles': {
                newServer.roleAssignments = update.data
                newServer.roleAssignmentsString = JSON.stringify(newServer.roleAssignments[newServer.connectivityInfo.userID])
                newServer.roleAssignmentsVersion = update.version
                break
            }
            case 'serverRoles': {
                newServer.serverRoles = update.data.list // TODO: deleted?
                newServer.serverRolesVersion = update.version
                break
            }
            case 'serverInfo': {
                newServer.serverInfo = update.data
                newServer.serverInfoVersion = update.version
                break
            }
            default:
                console.error('unknown update type:', update.type)
        }
    }

    return newStore
})

export const serverAddMessageToQueue = mainStore.createAction(
    'server/messageQueue/add',
    modifyServer((_, server, message: Immutable<UnsentMessage>) => ({
        ...server,
        messageQueue: [
            ...server.messageQueue,
            message,
        ]
    }))
)

export const setServerMessageQueue = mainStore.createAction(
    'server/messageQueue/set',
    modifyServer((_, server, mq: UnsentMessage[]) => ({
        ...server,
        messageQueue: mq
    }))
)

export const serverRemoveMessageFromQueue = mainStore.createAction(
    'server/messageQueue/remove',
    modifyServer((_, server, idempotence: string) => ({
        ...server,
        messageQueue: server.messageQueue.filter(m => m[0].idempotence !== idempotence)
    }))
)

export const addClientUser = mainStore.createAction('clientUsers/add', (store, clientUser: ClientUser) => ({
    ...store,
    clientUsers: {
        ...store.clientUsers,
        [clientUser.userID]: clientUser,
    },
}))

export function parseServerURL(url: string): URL {
    if (url.indexOf(':/') === -1) {
        url = 'https://' + url
    }
    return new URL(url)
}

function urlToConnectivityInfo(store: Immutable<MainStore>, url: string): ConnectivityInfo {
    let userID = ''
    for (const clientUserID in store.clientUsers) {
        userID = clientUserID
    }
    const info = {
        url: parseServerURL(url).href,
        token: '',
        userID,
        enabled: true,
        loaded: true,
    }

    // We make sure to save the connectivityInfo immediately so that it
    // isn't overwritten later on by a store changed handler thinking it
    // is a server ID that hasn't been loaded yet.
    savePersistent('connectivityInfo.' + store.nextServerID, info)

    return info
}

export const addServer = mainStore.createAction('servers/add', (store, ip: string) => ({
    ...store,
    nextServerID: store.nextServerID + 1,
    serverIDs: [...store.serverIDs, store.nextServerID],
    servers: {
        ...store.servers,
        [store.nextServerID]: {
            ...defaultServer,
            serverID: store.nextServerID,
            connectivityInfo: urlToConnectivityInfo(store, ip),
        },
    },
}))

const addMissingServers = mainStore.createAction('servers/addMissing', (store) => {
    const servers = { ...store.servers }
    for (const serverID of store.serverIDs) {
        if (servers[serverID] === undefined) {
            servers[serverID] = {
                ...defaultServer,
                serverID,
            }
        }
    }
    return {
        ...store,
        servers,
    }
})

export const setVoiceInputAudioDevice = mainStore.createAction('voice/inputAudioDevice/set', (store, inputAudioDevice: MediaDeviceInfo|undefined) => ({
    ...store,
    voice: {
        ...store.voice,
        inputAudioDevice: inputAudioDevice && inputAudioDevice.toJSON(), // TODO: Should this be validated?
    }
}))

const setAudioLevels = mainStore.createAction(
    'audioLevels/set',
    (store, audioLevels: AudioLevels) => ({
        ...store,
        audioLevels
    })
)

const setServerIDs = mainStore.createAction('serverIDs/set', (store, serverIDs: number[]) => {
    return {
        ...store,
        serverIDs,
    }
})

const setNextServerID = mainStore.createAction('nextServerID/set', (store, nextServerID: number) => ({
    ...store,
    nextServerID,
}))

const setClientUsers = mainStore.createAction(
    'clientUsers/set',
    (store, clientUsers: Record<string, ClientUser>) => {
        return {
            ...store,
            clientUsers,
        }
    }
)

export const navigate = mainStore.createAction('navigate', (store, location: NavigationLocation) => ({
    ...store,
    navigationStack: [...store.navigationStack, location],
}))

function allButOneLocation(t: Immutable<NavigationLocation[]>): Immutable<NavigationLocation[]> {
    const n = [...t]
    n.pop()
    return n
}

export const navigateUp = mainStore.createAction('navigateUp', (store) => store.navigationStack.length <= 1 ? store : ({
    ...store,
    navigationStack: allButOneLocation(store.navigationStack),
}))

export const addToast = mainStore.createAction('toasts/add', (store, toast: Toast) => ({
    ...store,
    toasts: [...store.toasts, toast]
}))
; (window as any).debugAddToast = addToast

export const dismissToast = mainStore.createAction('toasts/remove', (store, toastID: string) => ({
    ...store,
    toasts: store.toasts.filter(t => t.id !== toastID)
}))


function onChange<T>() {
    // We use function currying as a hack for the fact
    // that TypeScript doesn't support just specifying
    // some of the type arguments.
    return function onChangeImpl<K extends keyof T>(key: K) {
        const NOT_KNOWN = {}
        let value: Immutable<T[K]>|{} = NOT_KNOWN
        return (store: Immutable<T>) => {
            const newValue = store[key]
            const changed = newValue !== value && value !== NOT_KNOWN
            value = newValue
            return changed
        }
    }
}

const mainStoreChange = onChange<MainStore>()
const nextServerIDChanged = mainStoreChange('nextServerID')
const serverIDsChanged1 = mainStoreChange('serverIDs')
const clientUsersChanged = mainStoreChange('clientUsers')
const audioLevelsChanged = mainStoreChange('audioLevels')
const miscConfigChanged = mainStoreChange('miscConfig')
const voiceChanged = mainStoreChange('voice')

//const keyBindingsChanged = onChange(defaultStore.miscConfig, 'keyBindings')

export let currentDefaultMediaVolume = 1


// TODO: This flag is kinda ugly...
let saveMiscConfigIgnoreHack = true

export async function handleStoreChanged(s: Immutable<MainStore>) {
    //console.trace('hello!')
    currentDefaultMediaVolume = s.miscConfig.mediaVolume
    if (loadStates['nextServerID'] === LoadProgress.LOADED) {
        if (nextServerIDChanged(s)) {
            await savePersistent('nextServerID', s.nextServerID)
        }
    } else if (loadStates['nextServerID'] !== LoadProgress.LOADING) {
        await setNextServerID(await loadPersistent('nextServerID', 0))
    }

    if (loadStates['serverList'] === LoadProgress.LOADED) {
        if (serverIDsChanged1(s)) {
            await savePersistent('serverList', s.serverIDs)

            for (const serverID of s.serverIDs) {
                if (s.servers[serverID] === undefined) {
                    await addMissingServers()
                    return
                }
            }
        }
    } else if (loadStates['serverList'] !== LoadProgress.LOADING) {
        await setServerIDs(await loadPersistent('serverList', []))
        await addMissingServers()
    }

    if (loadStates['clientUsers'] === LoadProgress.LOADED) {
        if (clientUsersChanged(s)) {
            await savePersistent('clientUsers', s.clientUsers)
        }
    } else if (loadStates['clientUsers'] !== LoadProgress.LOADING) {
        await setClientUsers(await loadPersistent('clientUsers', {}))
    }

    if (loadStates['miscConfig'] === LoadProgress.LOADED) {
        if (miscConfigChanged(s) && saveMiscConfigIgnoreHack) {
            await savePersistent('miscConfig', s.miscConfig)
        }
    } else if (loadStates['miscConfig'] !== LoadProgress.LOADING) {
        await setMiscConfig({
            ...defaultMiscConfig, // Insert new settings as well.
            ...await loadPersistent('miscConfig', defaultMiscConfig),
            loaded: true,
        })
    }

    if (loadStates['voice'] === LoadProgress.LOADED) {
        if (voiceChanged(s)) {
            await savePersistent('voice', s.voice)
        }
    } else if (loadStates['voice'] !== LoadProgress.LOADING) {
        await setVoice({
            ...await loadPersistent('voice', defaultVoiceConfig),
            pushToTalkPressed: false,
            activeServerID: -1,
        })
    }

    if (loadStates['audioLevels'] === LoadProgress.LOADED) {
        if (audioLevelsChanged(s)) {
            await savePersistent('audioLevels', s.audioLevels)
        }
    } else if (loadStates['audioLevels'] !== LoadProgress.LOADING){
        await setAudioLevels(await loadPersistent('audioLevels', {}))
    }
}

export async function forceCentralAutoUpdateNow() {
    // Toggle the auto-updater on-and-off to force an auto-update check!
    // Persistency for miscConfig is also disabled during this time to
    // prevent unnecessary writes.
    // TODO: This is probably the very definition of a 'hack'.
    // TODO: Does this even work still with the new store implmentation?
    saveMiscConfigIgnoreHack = false
    await toggleCentralAutoUpdate()
    await toggleCentralAutoUpdate()
    saveMiscConfigIgnoreHack = true
}

;(window as any).debugAuthenticate = async (
    chainPEM: string,
    privateKeyPKCS8PEM: string,
    addServerIP?: string
) => {
    try {
        const key = await importPKCS8PEM(privateKeyPKCS8PEM)
        const chain = loadCertificatesFromMultiplePEM(chainPEM)
        const chainAsPKCS7 = chain.export('base64url')
        const analysis = await verifyX509Chain(chain/*, []*/)
        const publicKey = await crypto.subtle.exportKey('jwk', await exportAsSHA512(analysis.publicSessionKey, 'verify'))
        await ensurePrivateMatchesPublicKey(key, publicKey)
        await addClientUser({
            chain: chainAsPKCS7,
            key,
            publicKey,
            userID: analysis.userID,
        })
        console.log('%csuccessfully authenticated: %s', 'color: green;', analysis.userID)
    } catch (e) {
        console.error(e)
    }

    if (addServerIP) {
        addServer(addServerIP)
    }
}

