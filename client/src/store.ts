import { calculatePermissionsInContext } from './roles'
import { randomBase64, fromBase64 } from 'encoding_schemes'
import { changelog } from './changelog'
import { DEFAULT_MESSAGE_TIME_FORMAT } from './strftime'
import { defaultCentralURL } from './options'
import { AudioLevels, defaultVoiceConfig, VoiceConfig } from './voice_config'
import type { Immutable } from './immutable'
import type { ServerUser, Message, MessageAction, ServerToClientProvision, Role, Channel, DefinedPermission, ActiveChannel, ServerInfo } from './schema'
import { savePersistent } from './db' // TODO: Only used by lastNextMessageID.

export type NavigationLocation = 'login' | 'settings' | 'main'

// TODO: Replace all Record(s) with Map(s)
// TODO: Before doing that, benchmark performance difference in recreating Records and Maps
//       as seen in the functional style that store uses. Also investigate performance impact of
//       Object.setPrototypeOf and Object.assign
//       Using maps will decrease memory usage and increase saftey (by a little bit)

export async function savePersistentConfig(_name: string, _value: any) {
    // TODO: Move to petter place.
    // TODO: Implement such that it uses the launcher bridge config
}

export async function loadPersistentConfig(_name: string, _value: any) {

}

class Store<T> {
    storeDirty = true
    private guiListeners: (((newValue: Immutable<T>) => Promise<void> | void)|undefined)[] = []
    private guiListenersFreeIndex: number[] = []
    private value: Immutable<T>
    private handlersRunning = false
    private updateHandler = async (_s: Immutable<T>) => {
        console.error('updateHandler has not been set yet')
    }
    constructor(value: T) {
        this.value = value
        ;(window as any).debugStore = () => this.value
    }
    async runGuiListners(value: Immutable<T>) {
        // TODO: This method should be moved out of here, or even eliminated!
        for (const listener of this.guiListeners) {
            if (listener) {
                await listener(value)
            }
        }
    }
    subscribe(func: (value: Immutable<T>) => void) {
        // Registers a GUI listener. TODO: Move out of here.
        const index = this.guiListenersFreeIndex.pop() || this.guiListeners.length
        this.guiListeners[index] = func
        func(this.value)
        return () => {
            this.guiListenersFreeIndex.push(index)
            this.guiListeners[index] = undefined
        }
    }
    async maybeRunUpdateHandler() {
        //console.log('handlers: ', this.handlersRunning)
        if (!this.handlersRunning) {
            this.handlersRunning = true
            try {
                while(this.storeDirty) {
                    this.storeDirty = false
                    await this.updateHandler(this.value)
                }
            } finally {
                this.handlersRunning = false
            }
        }
    }
    async setUpdateHandler(f: (s: Immutable<T>) => Promise<void>) {
        this.updateHandler = f
        this.maybeRunUpdateHandler()
    }
    createAction<U extends any[]>(
        name: string,
        func: (value: Immutable<T>, ...parameters: U) => Immutable<T>
    ) {
        console.log('action added:', name)
        return async (...parameters: U) => {
            const previousValue = this.value
            const newValue = func(previousValue, ...parameters)
            this.value = newValue
            this.storeDirty = previousValue !== newValue
            await this.maybeRunUpdateHandler()
        }
    }
}

export enum AttachmentType {
    None,
    File,
    Image,
    Video,
    Audio,
}

interface TextComponent {
    flags: number,
    text: string
}

export interface ParsedMessageNormal {
    deleted: false
    msg: Message,
    time: string,
    attachmentType: AttachmentType,
    profileTimestamp: number,
    components: TextComponent[]
}
interface ParsedMessageDeleted {
    deleted: true
}
export type ParsedMessage = ParsedMessageNormal | ParsedMessageDeleted

export type Action = { action: string; idempotence: string; data: any }

export type UnsentMessage = [ MessageAction, File|undefined]

export let systemAllowsNotifications = false
export function confirmSystemAllowsNotifications() {
    systemAllowsNotifications = true
}

export type ClientUser = {
    /** Used to know on whose behalf to carry out actions */
    centralUsername?: string

    /** Stored as base64url-coded PKCS7 DER */
    chain: string

    /** Private key */
    key: JsonWebKey

    /** Public key */
    publicKey: JsonWebKey

    /** Derived from public key */
    userID: string
}

export const defaultProfileImage = 'chimp.png'

export const defaultProfile = {
    name: '',
    avatar: '',
    avatarMime: '',
    avatarURL: defaultProfileImage,
    timestamp: -1,
}
export type Profile = typeof defaultProfile

export const defaultConnectivityInfo = {
    url: '',
    token: '',
    enabled: true,
    userID: '',
    loaded: false,
}

export type ConnectivityInfo = typeof defaultConnectivityInfo

export const defaultVoiceChannel: Channel = {
    channelID: -1,
    name: '',
    permissions: undefined,
}

export const defaultTextChunk = {
    version: -1,
    messages: [] as ParsedMessage[] // TODO: Use correct type
}
export type TextChunk = typeof defaultTextChunk

// TODO: Move to a better location, same with calculation in App.svelte
export type RankCategory = {
    name: string
    rank: number
    users: ServerUser[]
}

export const defaultRoom = {
    version: -1,
    name: 'Loading...',
    description: '',
    chunkCount: -1,
    lastNextMessageID: -1,
    nextMessageID: -1,
    chunks: {} as Record<number, TextChunk>,
    chunksStart: 0,
    chunksWanted: 0,
    permissions: [] as Role[] | undefined,
    editingMessageIndex: -1,
    editingMessageChunkID: -1,
    hidden: false,
    draftedMessage: '',
    deleted: false,
}
export type TextRoom = typeof defaultRoom

let defaultServerInfo: ServerInfo = {
    name: 'Loading...'
}

export const defaultServer = {
    serverInfo: defaultServerInfo,
    serverInfoVersion: -1,
    icon: 'icon-256.png',
    serverID: -1,

    // TODO: Perhaps  remove?
    forcedUpdateAttempts: 0,

    connectivityInfo: defaultConnectivityInfo,
    attachmentsURL: '',
    profilesURL: '',

    messageQueue: [] as UnsentMessage[],

    definedPermissions: [] as DefinedPermission[],

    users: {} as Record<string, ServerUser>,
    usersVersion: -1,


    roomList: [] as number[],
    roomListVersion: -1,
    rooms: {} as Record<number, TextRoom>,
    shownRooms: [],
    viewedRoomID: -1,


    serverRoles: [] as Role[],
    serverRolesVersion: -1,
    roleAssignments: {} as Record<string, number[]>, // TODO: Move to users
    roleAssignmentsString: '', // TODO: Is this recomputed when userID changes?
    roleAssignmentsVersion: -1,
    channels: [] as Channel[],
    activeChannels: {} as Record<number, ActiveChannel>,
    channelsVersion: -1,
    activeChannelsVersion: -1,

    globalUserPermissions: {} as Record<string, boolean>,

    // TODO: We might be able to just use server.users
    userProfileTimestamp: -1,
}
export type Server = typeof defaultServer

export type Popup = {
    viewUserID?: string
    emojiPicker?: boolean
    authenticator?: string
    connectWithCentral?: string
    confirmDeleteMessage?: {
        serverID: number
        roomID: number
        chunkID: number
        messageIndex: number
    }
    viewImage?: string
    inviter?: string
    showChangelog?: boolean
}

const defaultLayout = {
    mobile: false,
    leftPanel: true,
    rightPanel: true,
}

export type Layout = typeof defaultLayout

// TODO: Maybe this should just become 3 variables of the UpdateAvailable component?
const defaultAutoUpdater = {
    latestVersion: '0.0.0',
    progress: 0,
    showing: false,
    canDownload: false,
}

export type AutoUpdater = typeof defaultAutoUpdater

type KeyBinding = {keyName: string, scanCode: number, global: boolean}
export type KeyBindings = Record<string, KeyBinding|undefined>

export const defaultKeyBindings: KeyBindings = {
    pushToTalk: {keyName: 'a', scanCode: 30, global: true},
}

export const defaultMiscConfig = {
    mediaVolume: 1,
    messageTimeFormat: DEFAULT_MESSAGE_TIME_FORMAT,
    changelogIndex: 0,
    overrideCentralURL: '',
    overrideServerManagerURL: '',
    autoUpdate: true,
    keyBindings: defaultKeyBindings,
    pushToTalk: false,
    loaded: false,
}

export type MiscConfig = typeof defaultMiscConfig

export interface Toast {
    id: string,
    serverID?: number,
    text: string,
    title: string,
    color: 'warning' | 'info' | 'error' | 'update' | 'success'
}

export const UNLOADED_SERVER_IDS = [] as number[]
export const UNLOADED_CLIENT_USERS = {} as Record<string, ClientUser>

export const defaultStore = {
    popup: {} as Popup,
    toasts: [] as Toast[],
    showAddServer: false,
    navigationStack: ['main'] as NavigationLocation[],
    lastActivityCheck: 0,
    servers: {} as Record<number, Server>,
    serverIDs: UNLOADED_SERVER_IDS,
    nextServerID: -1,
    clientUsers: UNLOADED_CLIENT_USERS,
    viewedServerID: -1,
    voice: defaultVoiceConfig,
    layout: defaultLayout,
    autoUpdater: defaultAutoUpdater,
    audioLevels: {} as AudioLevels,
    miscConfig: defaultMiscConfig,
}
export type MainStore = typeof defaultStore

export const mainStore = new Store(defaultStore)

export const setMediaVolume = mainStore.createAction(
    'defaultMediaVolume/set',
    (store, mediaVolume: number) => ({
        ...store,
        miscConfig: {
            ...store.miscConfig,
            mediaVolume,
        }
    })
)

export const updateLastActivityCheck = mainStore.createAction(
    'lastActivityCheck/set',
    (store) => ({
        ...store,
        lastActivityCheck: Date.now() / 1000
    })
)

export const setLayout = mainStore.createAction(
    'layout/set',
    (store, layout: Layout) => ({
        ...store,
        layout,
    })
)


export const setAudioLevel = mainStore.createAction(
    'audioLevels/user/set',
    (store, userID: string, audioLevel: number) => ({
        ...store,
        audioLevels: {
            ...store.audioLevels,
            [userID]: audioLevel
        }
    })
)

export const setChangelogIndex = mainStore.createAction(
    'changelogIndex/set',
    (store, changelogIndex: number) => store.miscConfig.changelogIndex === changelogIndex ? store : ({
        ...store,
        miscConfig: {
            ...store.miscConfig,
            changelogIndex,
        },
        popup: changelogIndex !== changelog.length ? {
            showChangelog: true
        } : store.popup
    })
)

export const setAutoUpdaterLatestVersion = mainStore.createAction(
    'autoUpdater/latestVersion/set',
    (store, latestVersion: string, canDownload: boolean) => ({
        ...store,
        autoUpdater: {
            ...store.autoUpdater,
            latestVersion,
            canDownload,
        }
    })
)

export const setAutoUpdaterProgress = mainStore.createAction(
    'autoUpdater/progress/set',
    (store, progress: number) => ({
        ...store,
        autoUpdater: {
            ...store.autoUpdater,
            progress,
            showing: store.autoUpdater.showing || progress >= 200 || progress <= -1
        }
    })
)

export const toggleCentralAutoUpdate = mainStore.createAction(
    'central/autoUpdate/toggle',
    (store) => ({
        ...store,
        miscConfig: {
            ...store.miscConfig,
            autoUpdate: !store.miscConfig.autoUpdate,
        },
        autoUpdater: {
            ...store.autoUpdater,
            url: ''
        }
    })
)

export const setShowAddServer = mainStore.createAction(
    'showAddServer/set',
    (store, showAddServer: boolean) => ({
        ...store,
        showAddServer,
    })
)

export const setActiveVoiceChannel = mainStore.createAction('voice/activeChannel/set', (store, activeVoiceServerID: number, activeChannelID: number) => ({
    ...store,
    voice: {
        ...store.voice,
        activeChannelID: activeChannelID,
        activeServerID: activeVoiceServerID
    }
}))

export const toggleCamera = mainStore.createAction('voice/selfVideo/toggle', store => ({
    ...store,
    voice: {
        ...store.voice,
        selfVideo: !store.voice.selfVideo
    }
}))


export const toggleSelfDeafen = mainStore.createAction('voice/selfDeafen/toggle', store => ({
    ...store,
    voice: {
        ...store.voice,
        selfDeafen: !store.voice.selfDeafen
    }
}))

export const toggleSelfMute = mainStore.createAction('voice/selfMute/toggle', store => ({
    ...store,
    voice: {
        ...store.voice,
        selfMute: !store.voice.selfMute
    }
}))

export const toggleNoiseSuppression = mainStore.createAction('voice/noiseSuppression/toggle', store => ({
    ...store,
    voice: {
        ...store.voice,
        noiseSuppression: !store.voice.noiseSuppression
    }
}))

export const setVoice = mainStore.createAction('voice/set', (store, voice: VoiceConfig) => ({
    ...store,
    voice: {
        ...voice,
        pushToTalkPressed: false,
    }
}))

export const setVoicePushToTalkPressed = mainStore.createAction('voice/pushToTalk/set', (store, state: boolean) => store.voice.pushToTalkPressed === state ? store :({
    ...store,
    voice: {
        ...store.voice,
        pushToTalkPressed: state,
    }
}))

export const setPopup = mainStore.createAction('popup/set', (store, popup: Popup) => ({
    ...store,
    popup,
}))

export function modifyServer<P extends any[]>(
    reducer: (
        store: Immutable<MainStore>,
        server: Immutable<Server>,
        ...args: P
    ) => Immutable<Server>
) {
    // TODO: Currently type-widening allows one to add bad values to the return type. How can we disable this?
    return (store: Immutable<MainStore>, serverID: number, ...args: P) => {
        const server = store.servers[serverID]
        if (server) {
            const newServer = reducer(store, server, ...args)
            return newServer !== server
                ? {
                      ...store,
                      servers: {
                          ...store.servers,
                          [serverID]: newServer,
                      },
                  }
                : store
        } else {
            return store
        }
    }
}

export const setViewedServerID = mainStore.createAction('viewedServerID/set', (store, id: number) => {
    const server = store.servers[id]
    return server
        ? {
              ...store,
              viewedServerID: id,
              servers: {
                  ...store.servers,
                  [id]: {
                      ...server,
                      forcedUpdateAttempts: server.forcedUpdateAttempts + 1,
                  },
              },
          }
        : {
              ...store,
              viewedServerID: id,
          }
})

export const setClientUserCentralUsername = mainStore.createAction(
    'clientUsers/centralUsername/set',
    (store, userID: string, username?: string) => {
        const user = store.clientUsers[userID]
        return user !== undefined ? {
            ...store,
            clientUsers: {
                ...store.clientUsers,
                [userID]: {
                    ...user,
                    centralUsername: username
                }
            }
        } : store
    }
)

export const deleteServer = mainStore.createAction('server/delete', (store, serverID: number) => ({
    ...store,
    serverIDs: store.serverIDs.filter((id) => id !== serverID),
    servers: {
        ...store.servers,
        [serverID]: undefined as any,
    },
}))

export const setServerRoomDraftedMessage = mainStore.createAction(
    'server/room/draftedMessage/set',
    modifyServer((_, server, roomID: number, draftedMessage: string) => {
        const room = server.rooms[roomID]
        return room
            ? {
                  ...server,
                  rooms: {
                      ...server.rooms,
                      [roomID]: {
                          ...room,
                          draftedMessage,
                      },
                  },
              }
            : server
    })
)

const setServerRoomLastNextMessageID = mainStore.createAction(
    'server/room/lastNextMessageID/set',
    modifyServer((_, server, roomID: number, lastNextMessageID: number) => {
        const room = server.rooms[roomID]
        return room
            ? {
                  ...server,
                  rooms: {
                      ...server.rooms,
                      [roomID]: {
                          ...room,
                          lastNextMessageID,
                      },
                  },
              }
            : server
    })
)

export async function updateServerRoomLastNextMessageID(serverID: number, roomID: number, nextMessageID: number) {
    await savePersistent(`lastNextMessageID.${serverID}.${roomID}`, nextMessageID)
    await setServerRoomLastNextMessageID(serverID, roomID, nextMessageID)
}

export const setServerViewedRoomID = mainStore.createAction(
    'server/viewedRoomID/set',
    modifyServer((_, server, roomID: number) => ({
        ...server,
        forcedUpdateAttempts: server.forcedUpdateAttempts + 1,
        viewedRoomID: roomID,
    }))
)

export const setServerConnectivityInfo = mainStore.createAction(
    'server/connectivityInfo/set',
    modifyServer((_, server, connectivityInfo: ConnectivityInfo) => {
        //console.log('setServerConnectivityInfo, ', connectivityInfo)
        if (connectivityInfo.token === '') {
            connectivityInfo = {
                ...connectivityInfo,
                token: randomBase64(24) // TODO: Use url safe base64 instead such that %20% and the likes can be avoided!
            }
        }
        return {
            ...server,
            userProfileTimestamp: -1, // In case the userID changed
            connectivityInfo,
        }
    })
)

export const setServerRoomEditingMessage = mainStore.createAction(
    'server/room/editingMessage',
    modifyServer((_, server, roomID: number, messageChunkID: number, messageIndex: number) => {
        const room = server.rooms[roomID]
        return room
            ? {
                  ...server,
                  rooms: {
                      ...server.rooms,
                      [roomID]: {
                          ...room,
                          editingMessageChunkID: messageChunkID,
                          editingMessageIndex: messageIndex,
                      },
                  },
                  forcedUpdateAttempts: server.forcedUpdateAttempts + 1, // TODO: This shouldn't be needed
              }
            : server
    })
)

export const setServerRoomChunkRange = mainStore.createAction(
    'server/room/chunkRange',
    modifyServer((_, server, roomID: number, start: number, length: number) => {
        const room = server.rooms[roomID]
        console.log('setServerRoomChunkRange:', start, length)
        return room && (room.chunksStart !== start || room.chunksWanted !== length)
            ? {
                  ...server,
                  rooms: {
                      ...server.rooms,
                      [roomID]: {
                          ...room,
                          chunksStart: start,
                          chunksWanted: length,
                      },
                  },
                  forcedUpdateAttempts: server.forcedUpdateAttempts + 1,
              }
            : server
    })
)

export const forceServerUpdate = mainStore.createAction(
    'server/forceUpdate',
    modifyServer((_, server) => ({
        ...server,
        forcedUpdateAttempts: server.forcedUpdateAttempts + 1,
    }))
)

export const setServerErrorFeedback = mainStore.createAction(
    'server/errorFeedback/set',
    modifyServer((_, server, errorFeedback: string) => ({
        ...server,
        errorFeedback,
    }))
)

export const updateServerProvision  = mainStore.createAction(
    'server/updateProvision',
    modifyServer((_store, server, response: ServerToClientProvision) => {
        return {
            ...server,
            attachmentsURL: response.attachmentsURL,
            profilesURL: response.profilesURL,
            definedPermissions: response.definedPermissions,
        }
    })
)

/*
TODO: Should we readd something like this again?
export const resetServerVersionNumbers  = mainStore.createAction('server/versions/reset', modifyServer((_store, server) => ({
    ...server,
    roomListVersion: -1,
    connectedUsersVersion: -1,
    serverRolesVersion: -1,
    roleAssignmentsVersion: -1,
    channelsVersion: -1,
    userProfileTimestamp: -1,
    profileTimestampsVersion: -1,
})))
*/

// TODO: Investigate how other parts of the program will react to this. But it should be safe already.
export const deleteClientUser = mainStore.createAction('clientUsers/delete', (store, clientUserID: string) => ({
    ...store,
    clientUsers: {
        ...store.clientUsers,
        [clientUserID]: undefined as any,
    }
}))

export const setMiscConfig = mainStore.createAction('miscConfig/set', (store, newMiscConfig: MiscConfig) => ({
    ...store,
    miscConfig: newMiscConfig,
    popup: newMiscConfig.changelogIndex !== changelog.length ? {
        showChangelog: true
    } : store.popup
}))

export const setKeyBinding = mainStore.createAction('miscConfig/keyBindings/set', (store, name: string, keyBinding: KeyBinding|undefined) => ({
    ...store,
    miscConfig: {
        ...store.miscConfig,
        keyBindings: {
            ...store.miscConfig.keyBindings,
            [name]: keyBinding
        }
    }
}))

export const togglePushToTalk = mainStore.createAction('central/pushToToggle/toggle', (store) => ({
    ...store,
    miscConfig: {
        ...store.miscConfig,
        pushToTalk: !store.miscConfig.pushToTalk,
    },
    voice: {
        ...store.voice,
        pushToTalkPressed: false
    },
}))

; (window as any).debugSetMiscConfig = setMiscConfig

// TODO: Find a more appropriate place for this helper
// TODO: Only used in one place, perhaps remove it, or start actually using it?
export function simpleChanged<T>(v: T) {
    let c = v
    return (nw: T) => {
        if (nw !== c) {
            c = nw
            return true
        }
        return false
    }
}

export let isMobileDevice = false

function setIsMobile() {
    isMobileDevice = true
    setLayout({
        mobile: true,
        leftPanel: true,
        rightPanel: false
    })
}


if ('androidApp' in window) {
    setIsMobile()
    systemAllowsNotifications = true
} else if (/Mobi|Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/i.test(navigator.userAgent)) {
    setIsMobile()
}

//setAutoUpdaterConfig(autoUpdateURL, appVersion, platform, setAutoUpdaterLatestVersion)
// TODO: Move elsewhere?

;(window as any).debugSetError = setServerErrorFeedback

;(window as any).debugShowUpdateAvailable = () => {
    setAutoUpdaterLatestVersion('99.0.0', true)
}

;(window as any).debugSetChangelogIndex = setChangelogIndex
