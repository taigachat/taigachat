import { randomBase64 } from "./encoding_schemes";
import { DEFAULT_MESSAGE_TIME_FORMAT } from "./strftime";
import { defaultVoiceConfig } from "./voice_config";
import type { AudioLevels, VoiceConfig } from "./voice_config";
import type { Immutable } from "./immutable";
import type {
    ServerUser,
    Message,
    MessageAction,
    ServerToClientProvision,
    Role,
    Channel,
    DefinedPermission,
    ActiveChannel,
    DomainPermission,
    ServerInfo,
} from "./schema";
import { savePersistent } from "./db"; // TODO: Only used by lastNextMessageID.
import type { SavedMainAuth, SavedExtraSecurity } from "./auth_methods";
import type { QueriedPermissions } from "./device_permissions";
import { registerDebugCommand } from "./debug_mode";

// TODO: Replace all Record(s) with Map(s)
// TODO: Before doing that, benchmark performance difference in recreating Records and Maps
//       as seen in the functional style that store uses. Also investigate performance impact of
//       Object.setPrototypeOf and Object.assign
//       Using maps will decrease memory usage and increase saftey (by a little bit)

export async function savePersistentConfig(_name: string, _value: Record<string, unknown>) {
    // TODO: Move to petter place.
    // TODO: Implement such that it uses the launcher bridge config
}

export async function loadPersistentConfig(_name: string, _value: Record<string, unknown>) {}

class Store<T> {
    storeDirty = true;
    private guiListeners: (((newValue: Immutable<T>) => Promise<void> | void) | undefined)[] = [];
    private guiListenersFreeIndex: number[] = [];
    private value: Immutable<T>;
    private handlersRunning = false;
    private updateHandler = async (_s: Immutable<T>) => {
        console.error("updateHandler has not been set yet");
    };
    constructor(value: T) {
        this.value = value;
        registerDebugCommand("store", () => this.value);
    }
    async runGuiListners(value: Immutable<T>) {
        // TODO: This method should be moved out of here, or even eliminated!
        for (const listener of this.guiListeners) {
            if (listener) {
                await listener(value);
            }
        }
    }
    subscribe(func: (value: Immutable<T>) => void) {
        // Registers a GUI listener. TODO: Move out of here.
        const index = this.guiListenersFreeIndex.pop() || this.guiListeners.length;
        this.guiListeners[index] = func;
        func(this.value);
        return () => {
            this.guiListenersFreeIndex.push(index);
            this.guiListeners[index] = undefined;
        };
    }
    async maybeRunUpdateHandler() {
        //console.log('handlers: ', this.handlersRunning)
        if (!this.handlersRunning) {
            this.handlersRunning = true;
            try {
                while (this.storeDirty) {
                    this.storeDirty = false;
                    await this.updateHandler(this.value);
                }
            } finally {
                this.handlersRunning = false;
            }
        }
    }
    setUpdateHandler(f: (s: Immutable<T>) => Promise<void>) {
        this.updateHandler = f;
        this.maybeRunUpdateHandler();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createAction<U extends any[]>(
        name: string,
        func: (value: Immutable<T>, ...parameters: U) => Immutable<T>
    ) {
        console.log("action added:", name);
        return async (...parameters: U) => {
            const previousValue = this.value;
            const newValue = func(previousValue, ...parameters);
            this.value = newValue;
            this.storeDirty = previousValue !== newValue;

            // TODO: Perhaps we could just onNextEVTick here instead. We'd have to check all act call sites before making this decision.
            await this.maybeRunUpdateHandler();
        };
    }
}

export type UnsentMessage = [MessageAction, File | undefined];

export type ClientUser = {
    /** Used to know on whose behalf to carry out actions. */
    centralUsername?: string;

    /** The current JWT given to us by the central login server. */
    centralLoginJWT?: string;

    /** What method is used to identify the user. */
    mainIdentifier: SavedMainAuth;

    /** Only allow this client to be used for these servers. */
    serverLock?: string[];

    /** Any additional security checks that can be used to access servers. */
    extraSecurity: SavedExtraSecurity[];

    /** The ID of the user that has replaced this user in usage (causes a transfer of user ID on the server). */
    supersededBy: string;

    /** A locally asigned userID. */
    localID: string;
};

export const defaultProfileImage = "chimp.png";

export const defaultListedServer = {
    url: "",

    enabled: true,

    /** From which local user to source the auth method. */
    localUserID: "",

    /** Represents the token that the client sends to that server to identify the device. */
    deviceID: "",

    /** The server will give the client one of these. Think of it as a temporary username for just that server. */
    sessionID: "",

    /** Just like sessionID but is secret, think of it as a temporary password. */
    sessionToken: "",
};

export type ListedServer = typeof defaultListedServer;

export const defaultTextChunk = {
    lastModified: -1,
    faddishness: 0,
    messages: [] as Message[],
};
export type TextChunk = typeof defaultTextChunk;

// TODO: Move to a better location, same with calculation in App.svelte
export type RankCategory = {
    name: string;
    penalty: number;
    users: Immutable<ServerUser>[];
};

export const defaultRoom = {
    name: "Loading...",
    description: "",
    encryptedBy: "",
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
    draftedMessage: "",
    deleted: false,
};
export type TextRoom = typeof defaultRoom;

const defaultServerInfo: ServerInfo = {
    name: "Loading...",
};

export const defaultServer = {
    // TODO: Create a versions subobject containing the versions.
    serverInfo: defaultServerInfo,
    serverInfoLastModified: -1,
    serverInfoFaddishness: 0,

    icon: "./out/icon-256.png", // TODO: Move to serverInfo
    serverID: "no-id",

    // TODO: Perhaps  remove?
    forcedUpdateAttempts: 0,

    userID: "",
    attachmentsURL: "",

    /** @deprecated use profileFetcher instead */
    profilesURL: "deprecated",

    messageQueue: [] as UnsentMessage[],

    definedPermissions: {} as Record<string, DefinedPermission>,

    users: {} as Record<string, ServerUser>,
    usersLastModified: -1,
    usersFaddishness: 0,

    rooms: {} as Record<number, TextRoom>,
    roomsLastModified: -1,
    roomsFaddishness: 0,
    shownRooms: [],
    viewedRoomID: -1,

    roles: [] as Role[],
    rolesLastModified: -1,
    rolesFaddishness: 0,

    domainPermissions: [] as DomainPermission[],
    domainPermissionsLastModified: -1,
    domainPermissionsFaddishness: 0,

    roleAssignmentsString: "", // TODO: Is this recomputed when userID changes?

    channels: [] as Channel[],
    channelsLastModified: -1,
    channelsFaddishness: 0,

    activeChannels: {} as Record<number, ActiveChannel>,
    activeChannelsLastModified: -1,
    activeChannelsFaddishness: 0,

    globalUserPermissions: {} as Record<string, boolean>,

    publicSalt: "",
};
export type Server = typeof defaultServer;

const defaultLayout = {
    mobile: false,
};

export type Layout = typeof defaultLayout;

// TODO: Maybe this should just become 3 variables of the UpdateAvailable component?
const defaultAutoUpdater = {
    latestVersion: "0.0.0",
    progress: 0,
    showing: false,
    canDownload: false,
};

export type AutoUpdater = typeof defaultAutoUpdater;

type KeyBinding = { keyName: string; scanCode: number; global: boolean };
export type KeyBindings = Record<string, KeyBinding | undefined>;

export const defaultKeyBindings: KeyBindings = {
    pushToTalk: { keyName: "a", scanCode: 30, global: true },
};

export const defaultMiscConfig = {
    mediaVolume: 1,
    messageTimeFormat: DEFAULT_MESSAGE_TIME_FORMAT,
    changelogIndex: 0,
    overrideCentralURL: "",
    overrideServerManagerURL: "",
    autoUpdate: true,
    keyBindings: defaultKeyBindings,
    pushToTalk: false,
    loaded: false,
};

export type MiscConfig = typeof defaultMiscConfig;

export interface Toast {
    id: string;
    serverID?: string;
    text: string;
    title: string;
    color: "warning" | "info" | "error" | "update" | "success";
}

export interface EndToEndEncryptionKey {
    salt: string;
    fingerprint: string;
    encryptedKey: string;
    iv: string;
}

export const UNLOADED_SERVER_IDS = [] as number[];
export const UNLOADED_CLIENT_USERS = {} as Record<string, ClientUser>;
export const UNLOADED_SERVER_LIST = {} as Record<string, ListedServer>;
export const UNLOADED_END_TO_END_ENCRYPTION_KEYS = {} as Record<string, EndToEndEncryptionKey>;

export const defaultStore = {
    toasts: [] as Toast[],
    lastActivityCheck: 0,
    listedServers: UNLOADED_SERVER_LIST,
    servers: {} as Record<string, Server>,
    nextServerID: -1,
    clientUsers: UNLOADED_CLIENT_USERS,
    voice: defaultVoiceConfig,
    endToEndEncryptionKeys: UNLOADED_END_TO_END_ENCRYPTION_KEYS,
    layout: defaultLayout,
    autoUpdater: defaultAutoUpdater,
    audioLevels: {} as AudioLevels,
    miscConfig: defaultMiscConfig,
    permissions: {} as QueriedPermissions,
};
export type MainStore = typeof defaultStore;

export const mainStore = new Store(defaultStore);

export const setMediaVolume = mainStore.createAction(
    "defaultMediaVolume/set",
    (store, mediaVolume: number) => ({
        ...store,
        miscConfig: {
            ...store.miscConfig,
            mediaVolume,
        },
    })
);

export const updateLastActivityCheck = mainStore.createAction("lastActivityCheck/set", (store) => ({
    ...store,
    lastActivityCheck: Date.now() / 1000,
}));

export const setLayout = mainStore.createAction("layout/set", (store, layout: Layout) => ({
    ...store,
    layout,
}));

export const toggleMobileUI = mainStore.createAction("layout/mobileUI/toggle", (store) => ({
    ...store,
    layout: {
        ...store.layout,
        mobile: !store.layout.mobile,
    },
}));

export const setAudioLevel = mainStore.createAction(
    "audioLevels/user/set",
    (store, userID: string, audioLevel: number) => ({
        ...store,
        audioLevels: {
            ...store.audioLevels,
            [userID]: audioLevel,
        },
    })
);

export const setChangelogIndex = mainStore.createAction(
    "changelogIndex/set",
    (store, changelogIndex: number) =>
        store.miscConfig.changelogIndex === changelogIndex
            ? store
            : {
                  ...store,
                  miscConfig: {
                      ...store.miscConfig,
                      changelogIndex,
                  },
              }
);

export const setAutoUpdaterLatestVersion = mainStore.createAction(
    "autoUpdater/latestVersion/set",
    (store, latestVersion: string, canDownload: boolean) => ({
        ...store,
        autoUpdater: {
            ...store.autoUpdater,
            latestVersion,
            canDownload,
        },
    })
);

export const setAutoUpdaterProgress = mainStore.createAction(
    "autoUpdater/progress/set",
    (store, progress: number) => ({
        ...store,
        autoUpdater: {
            ...store.autoUpdater,
            progress,
            showing: store.autoUpdater.showing || progress >= 200 || progress <= -1,
        },
    })
);

export const toggleCentralAutoUpdate = mainStore.createAction("central/autoUpdate/toggle", (store) => ({
    ...store,
    miscConfig: {
        ...store.miscConfig,
        autoUpdate: !store.miscConfig.autoUpdate,
    },
    autoUpdater: {
        ...store.autoUpdater,
        url: "",
    },
}));

export const setActiveVoiceChannel = mainStore.createAction(
    "voice/activeChannel/set",
    (store, activeVoiceServerID: string, activeChannelID: number) => ({
        ...store,
        voice: {
            ...store.voice,
            activeChannelID: activeChannelID,
            activeServerID: activeVoiceServerID,
        },
    })
);

export const toggleCamera = mainStore.createAction("voice/selfVideo/toggle", (store) => ({
    ...store,
    voice: {
        ...store.voice,
        selfVideo: !store.voice.selfVideo,
    },
}));

export const toggleSelfDeafen = mainStore.createAction("voice/selfDeafen/toggle", (store) => ({
    ...store,
    voice: {
        ...store.voice,
        selfDeafen: !store.voice.selfDeafen,
    },
}));

export const toggleSelfMute = mainStore.createAction("voice/selfMute/toggle", (store) => ({
    ...store,
    voice: {
        ...store.voice,
        selfMute: !store.voice.selfMute,
    },
}));

export const toggleNoiseSuppression = mainStore.createAction("voice/noiseSuppression/toggle", (store) => ({
    ...store,
    voice: {
        ...store.voice,
        noiseSuppression: !store.voice.noiseSuppression,
    },
}));

export const setVoice = mainStore.createAction("voice/set", (store, voice: VoiceConfig) => ({
    ...store,
    voice: {
        ...voice,
        pushToTalkPressed: false,
    },
}));

export const setVoicePushToTalkPressed = mainStore.createAction(
    "voice/pushToTalk/set",
    (store, state: boolean) =>
        store.voice.pushToTalkPressed === state
            ? store
            : {
                  ...store,
                  voice: {
                      ...store.voice,
                      pushToTalkPressed: state,
                  },
              }
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function modifyServer<P extends any[]>(
    reducer: (store: Immutable<MainStore>, server: Immutable<Server>, ...args: P) => Immutable<Server>
) {
    // TODO: Currently type-widening allows one to add bad values to the return type. How can we disable this?
    return (store: Immutable<MainStore>, serverID: string, ...args: P) => {
        const server = store.servers[serverID];
        if (server) {
            const newServer = reducer(store, server, ...args);
            return newServer !== server
                ? {
                      ...store,
                      servers: {
                          ...store.servers,
                          [serverID]: newServer,
                      },
                  }
                : store;
        } else {
            return store;
        }
    };
}

export const setClientUserCentralUsername = mainStore.createAction(
    "clientUsers/centralUsername/set",
    (store, userID: string, username?: string) => {
        const user = store.clientUsers[userID];
        return user !== undefined
            ? {
                  ...store,
                  clientUsers: {
                      ...store.clientUsers,
                      [userID]: {
                          ...user,
                          centralUsername: username,
                      },
                  },
              }
            : store;
    }
);

export const deleteServer = mainStore.createAction("server/delete", (store, serverID: string) => {
    const newListedServers = { ...store.listedServers };
    delete newListedServers[serverID];
    return {
        ...store,
        listedServers: newListedServers,
        servers: {
            ...store.servers,
            [serverID]: undefined as unknown as Server,
        },
    };
});

export const setServerRoomDraftedMessage = mainStore.createAction(
    "server/room/draftedMessage/set",
    modifyServer((_, server, roomID: number, draftedMessage: string) => {
        const room = server.rooms[roomID];
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
            : server;
    })
);

const setServerRoomLastNextMessageID = mainStore.createAction(
    "server/room/lastNextMessageID/set",
    modifyServer((_, server, roomID: number, lastNextMessageID: number) => {
        const room = server.rooms[roomID];
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
            : server;
    })
);

export async function updateServerRoomLastNextMessageID(
    serverID: string,
    roomID: number,
    nextMessageID: number
) {
    await savePersistent(`lastNextMessageID.${serverID}.${roomID}`, nextMessageID);
    await setServerRoomLastNextMessageID(serverID, roomID, nextMessageID);
}

export const setServerViewedRoomID = mainStore.createAction(
    "server/viewedRoomID/set",
    modifyServer((_, server, roomID: number) => ({
        ...server,
        // TODO: If things start to go crazy, reenable this: //forcedUpdateAttempts: server.forcedUpdateAttempts + 1,
        viewedRoomID: roomID,
    }))
);

export const setServerConnectivityInfo = mainStore.createAction(
    "listsedServers/info/set",
    (store: Immutable<MainStore>, serverID: string, info: ListedServer) => {
        //console.log('setServerConnectivityInfo, ', connectivityInfo)
        if (info.deviceID === "") {
            info = {
                ...info,
                deviceID: randomBase64(24), // TODO: Use url safe base64 instead such that %20% and the likes can be avoided!
            };
        }
        return {
            ...store,
            listedServers: {
                ...store.listedServers,
                [serverID]: info,
            },
        };
    }
);

export const setServerRoomEditingMessage = mainStore.createAction(
    "server/room/editingMessage",
    modifyServer((_, server, roomID: number, messageChunkID: number, messageIndex: number) => {
        const room = server.rooms[roomID];
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
            : server;
    })
);

export const setServerRoomChunkRange = mainStore.createAction(
    "server/room/chunkRange",
    modifyServer((_, server, roomID: number, start: number, length: number) => {
        const room = server.rooms[roomID];
        console.log("setServerRoomChunkRange:", start, length);
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
            : server;
    })
);

export const forceServerUpdate = mainStore.createAction(
    "server/forceUpdate",
    modifyServer((_, server) => ({
        ...server,
        forcedUpdateAttempts: server.forcedUpdateAttempts + 1,
    }))
);

export const updateServerProvision = mainStore.createAction(
    "server/updateProvision",
    modifyServer((_store, server, response: ServerToClientProvision) => {
        return {
            ...server,
            publicSalt: response.publicSalt,
            attachmentsURL: response.attachmentsURL,
            userID: response.userID,
            definedPermissions: response.definedPermissions,
        };
    })
);

/*
TODO: Should we readd something like this again?
export const resetServerVersionNumbers  = mainStore.createAction('server/versions/reset', modifyServer((_store, server) => ({
    ...server,
    roomListVersion: -1,
    connectedUsersVersion: -1,
    serverRolesVersion: -1,
    roleAssignmentsVersion: -1,
    channelsVersion: -1,
    profileTimestampsVersion: -1,
})))
*/

// TODO: Investigate how other parts of the program will react to this. But it should be safe already.
export const deleteClientUser = mainStore.createAction(
    "clientUsers/delete",
    (store, clientUserID: string) => {
        const newClientUsers = { ...store.clientUsers };
        delete newClientUsers[clientUserID];
        return {
            ...store,
            clientUsers: newClientUsers,
        };
    }
);

registerDebugCommand("deleteClientUser", deleteClientUser);

export const setMiscConfig = mainStore.createAction("miscConfig/set", (store, newMiscConfig: MiscConfig) => ({
    ...store,
    miscConfig: newMiscConfig,
}));

export const setKeyBinding = mainStore.createAction(
    "miscConfig/keyBindings/set",
    (store, name: string, keyBinding: KeyBinding | undefined) => ({
        ...store,
        miscConfig: {
            ...store.miscConfig,
            keyBindings: {
                ...store.miscConfig.keyBindings,
                [name]: keyBinding,
            },
        },
    })
);

export const togglePushToTalk = mainStore.createAction("central/pushToToggle/toggle", (store) => ({
    ...store,
    miscConfig: {
        ...store.miscConfig,
        pushToTalk: !store.miscConfig.pushToTalk,
    },
    voice: {
        ...store.voice,
        pushToTalkPressed: false,
    },
}));

registerDebugCommand("setMiscConfig", setMiscConfig);

// TODO: Find a more appropriate place for this helper
// TODO: Only used in one place, perhaps remove it, or start actually using it?
export function simpleChanged<T>(v: T) {
    let c = v;
    return (nw: T) => {
        if (nw !== c) {
            c = nw;
            return true;
        }
        return false;
    };
}

export let isMobileDevice = false;

export function setIsMobile() {
    isMobileDevice = true;
    setLayout({
        mobile: true,
    });
}

//setAutoUpdaterConfig(autoUpdateURL, appVersion, platform, setAutoUpdaterLatestVersion)
// TODO: Move elsewhere?

registerDebugCommand("showUpdateAvailable", () => {
    setAutoUpdaterLatestVersion("99.0.0", true);
});

registerDebugCommand("setChangelogIndex", setChangelogIndex);
