import {
    loadPersistent,
    savePersistent,
    loadStates,
    LoadProgress,
} from './db'
import { toRadix64 } from './radix64'
import {
    mainStore,
    setServerConnectivityInfo,
    defaultConnectivityInfo,
    updateServerProvision,
    defaultServer,
    UNLOADED_SERVER_IDS,
} from './store'
import type { MainStore, ClientUser, Server, ConnectivityInfo } from './store'

import { asMutable, Immutable } from './immutable'

import { setServerMessageQueue, serverRemoveMessageFromQueue, ingestUpdates, addToast, dismissToast, addServer, parseServerURL } from './acts'
import { appVersion, autoJoinURL } from './options'

import { updateObjects, serverToClientProvision, messageFromSFU, messageAttachmentIdempotence, profileUploadURL } from './schema'
import { getProfile, profileWatcher } from './profiles'
import { get } from 'svelte/store'
import { handleSFUMessage } from './call'
import { actionsIngestServerConnectivityInfo, getServerAuthenticatedURL, onServer } from './actions'
import { handleAttachmentURL, sendMessageAction } from './message_sender'
import { EMPTY_URL } from './join_url'

const seenClientVersions: Record<string, boolean> = {}

let currentMainStore = get(mainStore)

function createReceivedVersions(server: Immutable<Server>, isViewedServer: boolean, reloadRooms: boolean, reloadChannels: boolean): string {
    const userRoles = `userRoles.${toRadix64(server.roleAssignmentsVersion)}`
    const serverRoles = `~serverRoles.${toRadix64(server.serverRolesVersion)}`
    const roomList = isViewedServer ? `~rooms.${toRadix64(server.roomListVersion)}` : ''
    const channels = `~channels.${reloadChannels ? '' : toRadix64(server.channelsVersion) }`
    const activeChannels = `~activeChannels.${toRadix64(server.activeChannelsVersion)}`
    const serverInfo = `~serverInfo.${toRadix64(server.serverInfoVersion)}`
    let versionStr = `${userRoles}${serverRoles}${roomList}${channels}${activeChannels}${serverInfo}`

    const room = server.rooms[server.viewedRoomID]
    if (isViewedServer && room && server.viewedRoomID !== -1) {
        for (let i = 0; i < room.chunksWanted; i++) {
            const chunkID = room.chunksStart + i
            const chunk = room.chunks[chunkID]
            versionStr += `~chunk.${server.viewedRoomID}.${chunkID}.${chunk !== undefined ? toRadix64(chunk.version) : ''}`
        }
    }

    for (const roomID of server.roomList) {
        // TODO: Room versions could be computed in the store instead.
        const room = server.rooms[roomID]
        const version = reloadRooms
            ? ''
            : room !== undefined
                ? toRadix64(room.version)
                : ''
        versionStr += `~room.${roomID}.${version}`
    }
    versionStr += `~users.${toRadix64(server.usersVersion)}`

    return versionStr

}

async function addErrorToast(serverID: number, text: string) {
    let toastCount = 0
    let firstToast = ""
    for(const toast of currentMainStore.toasts) {
        if (toast.serverID === serverID) {
            toastCount++
            firstToast ||= toast.id
        }
    }
    if (toastCount >= 5) {
        await dismissToast(firstToast)
    }

    await addToast({
        title: `Server #${serverID}`,
        id: `feedback-${serverID}-${Date.now()}`,
        serverID: serverID,
        color: 'error',
        text,
    })
}

class NetConnection {
    socket: EventSource
    serverID: number
    closed = false
    oldReceivedVersions = ''
    oldGlobalUserPermissions: Record<string, boolean> = {}
    oldRoleAssignmentsString = ''
    shouldSendOldMessages = false
    unsubscribeProfileWatcher: () => void
    sessionNumber = 0
    newestProfileTimestamp = 0
    userID = ''

    constructor(serverID: number, clientUser: Immutable<ClientUser>, initialConnectivityInfo: ConnectivityInfo) {
        this.userID = clientUser.userID
        this.unsubscribeProfileWatcher = profileWatcher(this.userID).subscribe(this.profileChanged)
        const socket = new EventSource(getServerAuthenticatedURL(initialConnectivityInfo, 'updates'))
        this.socket = socket
        this.serverID = serverID

        console.log('attempting connection')

        socket.addEventListener('open', () => {
            console.log('connection established')
            onServer.userIsActive0(serverID)
            this.shouldSendOldMessages = true
        })

        socket.addEventListener('error', event => {
            console.error('could not connect')
            console.log(event)
        })

        socket.addEventListener('update0', async (event) => {
            const updates = JSON.parse(event.data)
            const u = updateObjects.parse(updates)
            await ingestUpdates(this.serverID, u)
        })

        socket.addEventListener('sessionNumber0', (n) => {
            this.sessionNumber = parseInt(n.data)
            const server = currentMainStore.servers[serverID]
            if (!server) {
                return
            }
            this.tryResendOldMessages(server)
            this.sendReceivedVersions(server)
        })

        socket.addEventListener('sfuMessage0', async (event) => {
            const message = JSON.parse(event.data)
            const m = messageFromSFU.parse(message)
            handleSFUMessage(serverID, m)
        })

        socket.addEventListener('newAttachmentURL0', async (event) => {
            const message = JSON.parse(event.data)
            const m = messageAttachmentIdempotence.parse(message)
            handleAttachmentURL(serverID, m)
        })

        socket.addEventListener('newProfileURL0', async (event) => {
            const message = JSON.parse(event.data)
            const m = profileUploadURL.parse(message)
            if (m.userID !== this.userID) {
                return
            }
            const timestamp = this.newestProfileTimestamp || m.profileTimestamp
            const profile = await getProfile(EMPTY_URL, m.userID, timestamp)
            await fetch(m.uploadURL, {
                method: 'PUT',
                // TODO: Perhaps just using arrayBuffer directly would be better
                body: new File([profile.arrayBuffer], 'profile.png')
            })
            await onServer.setProfile0(this.serverID, timestamp)
        })

        socket.addEventListener('provision0', async (event) => {
            const provision = JSON.parse(event.data)
            const p = serverToClientProvision.parse(provision)
            await updateServerProvision(this.serverID, p)
            // TODO: Inform actions.ts about the supportedActions!
        })

        ; (window as any).debugSocket = socket
    }
    close() {
        console.warn('server closed')
        this.unsubscribeProfileWatcher()
        this.closed = true
        this.socket.close()
        let instance = instances[this.serverID]
        if (instance) {
            instance.net = undefined
        }
    }
    profileChanged = async (profileTimestamp: number) => {
        this.newestProfileTimestamp = profileTimestamp
        await onServer.requestProfileUpload0(this.serverID, profileTimestamp)
    }
    sendReceivedVersions(server: Immutable<Server>) {
        let reloadRooms = false
        let reloadChannels = false
        if (this.oldGlobalUserPermissions !== server.globalUserPermissions || this.oldRoleAssignmentsString !== server.roleAssignmentsString) {
            // We could detect the change by waiting for changes in handleServerToClientUpdate instead
            // TODO: Would that be better?

            // TODO: Here is another idea, we could move out permissions into their own object

            //console.log('global user permissions changed:', server.globalUserPermissions, this.oldRoleAssignmentsString, server.roleAssignmentsString)

            // Check if permission MIGHT have been changed.
            const permissionChanged = (name: string) => {
                return (this.oldRoleAssignmentsString !== server.roleAssignmentsString) || this.oldGlobalUserPermissions[name] !== server.globalUserPermissions[name]
            }
            reloadRooms = permissionChanged('read_chat') || permissionChanged('edit_roles')
            reloadChannels = permissionChanged('join_channel') || permissionChanged('edit_roles')
            this.oldGlobalUserPermissions = server.globalUserPermissions
            this.oldRoleAssignmentsString = server.roleAssignmentsString
        }

        const receivedVersions = createReceivedVersions(server,
                                                        currentMainStore.viewedServerID === this.serverID,
                                                        reloadRooms,
                                                        reloadChannels)

        onServer.setVersions0(this.serverID, this.sessionNumber, receivedVersions)

    }
    async tryResendOldMessages(server: Immutable<Server>) {
        if (this.shouldSendOldMessages
            && loadStates['messageQueue.'+this.serverID] == LoadProgress.LOADED) {
            // Only start sending old messages once the
            // connection is established.

            this.shouldSendOldMessages = false
            for(const unsent of server.messageQueue) {
                sendMessageAction(this.serverID, asMutable(unsent[0]), asMutable(unsent[1]))
            }
        }
    }
    serverChanged(server: Immutable<Server>, oldServer: Immutable<Server>) {
        if (server.forcedUpdateAttempts !== oldServer.forcedUpdateAttempts) {
            this.sendReceivedVersions(server)
        }
        this.tryResendOldMessages(server)
    }
}

interface NetConnectionAndConnectivityInfo {
    info: ConnectivityInfo
    net?: NetConnection
    serverID: number
    needsSave: boolean,
    needsSaveMessageQueue: boolean,
    messageQueueID: string,
}

const instances: Record<number, NetConnectionAndConnectivityInfo> = {}

async function loadConnectvityInfo(serverID: number) {
    await setServerConnectivityInfo(
        serverID,
        await loadPersistent('connectivityInfo.' + serverID, {
            ...defaultConnectivityInfo,
            loaded: true,
        })
    )
}

// TODO: Refactor
export function serverNetCodeSubscribe() {
    seenClientVersions[appVersion] = true
    /*window.addEventListener('beforeunload', () => {
        for(const id in netServers) {
            // kill the server
        }
    })*/
}

async function connectivityInfoChanged(instance: NetConnectionAndConnectivityInfo, store: Immutable<MainStore>) {
    let loadName = `connectivityInfo.${instance.serverID}`
    if (loadStates[loadName] === LoadProgress.LOADED) {
        // This if statement prevents saving connectivityInfo
        // because it was changed due to a program-start load
        if (instance.needsSave) {
            await savePersistent(loadName, instance.info)
        } else {
            instance.needsSave = true
        }
    }
    actionsIngestServerConnectivityInfo(instance.serverID, instance.info)
    if (instance.info.enabled) {
        if (instance.info.token === '') {
            // TODO: Perhaps there is a cleaner way to ensure that token is always
            // set to something.
            setServerConnectivityInfo(instance.serverID, instance.info)
            return
        }

        const clientUser = store.clientUsers[instance.info.userID]
        if (clientUser) {
            instance.net = new NetConnection(instance.serverID, clientUser, instance.info)
        } else {
            console.error('clientUser not loaded yet!')
            // TODO: handle in a better way
        }
    }
}

export async function handleStoreChanged(store: Immutable<MainStore>) {
    const oldStore = currentMainStore
    currentMainStore = store

    if (oldStore.servers !== store.servers) {
        // TODO: A proper removal of a server should write connectivityInfo.N to {} or something
        // TODO: As well as messageQueue.N
        // TODO: Proper server removal should also remove the instance object...

        for (const serverID of store.serverIDs) {
            const server = store.servers[serverID]
            let instance = instances[serverID]
            if (server !== undefined) {
                if (instance === undefined) {
                    let loadName = `connectivityInfo.${serverID}`
                    instance = instances[serverID] = {
                        info: server.connectivityInfo,
                        net: undefined,
                        serverID,
                        needsSave: false,
                        needsSaveMessageQueue: false,
                        messageQueueID: `messageQueue.${serverID}`
                        //loaded: server.connectivityInfo.loaded,
                    }
                    if (loadStates[loadName] === LoadProgress.LOADED) {
                        await connectivityInfoChanged(instance, store)
                    } else if (loadStates[loadName] !== LoadProgress.LOADING) {
                        await loadConnectvityInfo(instance.serverID)
                    }
                } else if (instance.info !== server.connectivityInfo && server.connectivityInfo.loaded) {
                    if (instance.net !== undefined && instance.info.loaded) {
                        instance.net.close()
                    }
                    instance.info = server.connectivityInfo
                    await connectivityInfoChanged(instance, store)
                }
            }
        }
    }

    for (const serverID in instances) {
        const instance = instances[serverID]!
        const server = store.servers[serverID]
        if (server) {
            const oldServer = oldStore.servers[serverID] || defaultServer
            if (server !== oldServer) {
                if (instance.net) {
                    instance.net.serverChanged(server, oldServer)
                }
                if (loadStates[instance.messageQueueID] === LoadProgress.LOADED) {
                    if (server.messageQueue !== oldServer.messageQueue) {
                        if (instance.needsSaveMessageQueue) {
                            await savePersistent(instance.messageQueueID, server.messageQueue)
                        } else {
                            instance.needsSaveMessageQueue = true
                        }
                    }
                } else if (loadStates[instance.messageQueueID] !== LoadProgress.LOADING) {
                    await setServerMessageQueue(parseInt(serverID), await loadPersistent(instance.messageQueueID, []))
                }
            }
        } else if (instance.net) {
            instance.net.close()
        }
    }

    autoJoinServerURL()
}

let tryAutoJoinServer = true
async function autoJoinServerURL() {
    // TODO: Perhaps display a popup in the future

    if (!tryAutoJoinServer) {
        return
    }
    if (!autoJoinURL) {
        tryAutoJoinServer = false
        return
    }
    if (currentMainStore.serverIDs === UNLOADED_SERVER_IDS) {
        return
    }
    for (const serverID of currentMainStore.serverIDs) {
        let loadName = `connectivityInfo.${serverID}`
        if (loadStates[loadName] !== LoadProgress.LOADED) {
            // Not everything is loaded yet!
            return
        }
    }
    let url: URL
    try {
        url = parseServerURL(autoJoinURL)
    } catch (e) {
        tryAutoJoinServer = false
        return
    }
    for(const serverID in currentMainStore.servers) {
        const server = currentMainStore.servers[serverID]
        if (server === undefined || !server.connectivityInfo.loaded) {
            return
        }
        console.log('comparing:', server.connectivityInfo.url, url.href)
        if (server.connectivityInfo.url === url.href) {
            tryAutoJoinServer = false
            console.warn('already joined: ', url.href)
            return
        }
    }

    for (const _ in currentMainStore.clientUsers) {
        // This will only run if there is a clientUser
        // TODO: Replace with an isNotEmpty check in the future once we have a place for that function.
        tryAutoJoinServer = false
        await addServer(url.href)
        return
    }
}

; (window as any).debugClearMessageQueue = () => {
    const serverID = currentMainStore.viewedServerID
    const server = currentMainStore.servers[serverID]
    if (!server) {
        throw 'select a server first'
    }
    for (const message of server.messageQueue) {
        serverRemoveMessageFromQueue(serverID, message[0].idempotence)
    }
}

// TODO: Use https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
