import { savePersistent, loadPersistent, loadStates, LoadProgress } from "./db";
import { defaultVoiceConfig } from "./voice_config";
import type { AudioLevels } from "./voice_config";
import {
    modifyServer,
    mainStore,
    defaultServer,
    defaultRoom,
    defaultMiscConfig,
    toggleCentralAutoUpdate,
    setVoice,
    setMiscConfig,
    defaultTextChunk,
} from "./store";
import type { Toast, TextRoom } from "./store";
import type { UnsentMessage, MainStore, ClientUser, ListedServer, Server } from "./store";
import type { Immutable, AlmostImmutable } from "./immutable";
import { fetchLocalProfile, getLocalProfile, insertLocalProfile, VALID_PROFILE_START_DATE } from "./profiles";
import type {
    ActiveChannel,
    Channel,
    DomainPermission,
    Role,
    ServerUser,
    UpdateObjectVariants,
} from "./schema";
import { changelog } from "./changelog";
import { setPopup } from "./routes";
import type { DevicePermission, PermissionState } from "./device_permissions";
import { registerDebugCommand } from "./debug_mode";

// TODO: This file will eventually contain all the createAction() calls

export const ingestUpdates = mainStore.createAction(
    "ingestUpdates",
    (store, serverID: string, updates: UpdateObjectVariants[]) => {
        const newStore: AlmostImmutable<MainStore> = { ...store };
        const server = store.servers[serverID];
        if (server === undefined) {
            return store;
        }

        const info = store.listedServers[serverID];
        if (info === undefined) {
            return store;
        }

        const newServer: AlmostImmutable<Server> = {
            ...server,
            forcedUpdateAttempts: server.forcedUpdateAttempts + 1,
        };

        newStore.servers = {
            ...newStore.servers,
            [serverID]: newServer,
        };

        //console.dir(updates)

        // TODO: We could have a bool that told us if we expect to receive more updates.
        // Then we stash away our new updated lists somewhere. Once we have received the last update for
        // this cycle, we add the lists to the current server data object. The lists are then cleared.

        let newRooms: Record<number, AlmostImmutable<TextRoom>> | undefined = undefined;

        const newRoles: Role[] = [];
        let rolesUpdated = false;

        const newPermissions: DomainPermission[] = [];
        let permissionsUpdated = false;

        const newChannels: Channel[] = [];
        let channelsUpdated = false;

        let newActiveChannels: Record<number, Immutable<ActiveChannel>> | undefined = undefined;

        let newUsers: Record<string, Immutable<ServerUser>> | undefined = undefined;

        const messageUpdates: UpdateObjectVariants[] = [];

        for (const update of updates) {
            // TODO: Should a switch count as one or two levels of indent? We might be over 3

            switch (update.type) {
                case "room": {
                    if (newRooms === undefined) {
                        // Empty it. We expect to get a list of new rooms.
                        newRooms = {};
                    }
                    const roomID = update.data.roomID;
                    const currentRoom = newRooms[roomID] || server.rooms[roomID] || defaultRoom;

                    newRooms[roomID] = {
                        ...currentRoom,
                        ...update.data,
                    };

                    if (
                        newServer.roomsLastModified < update.lastModified ||
                        (newServer.roomsLastModified === update.lastModified &&
                            newServer.roomsFaddishness < update.faddishness)
                    ) {
                        newServer.roomsLastModified = update.lastModified;
                        newServer.roomsFaddishness = update.faddishness;
                    }

                    break;
                }
                case "message": {
                    console.log("msg rece");
                    messageUpdates.push(update);
                    break;
                }
                case "role": {
                    if (
                        newServer.rolesLastModified < update.lastModified ||
                        (newServer.rolesLastModified === update.lastModified &&
                            newServer.rolesFaddishness < update.faddishness)
                    ) {
                        newServer.rolesLastModified = update.lastModified;
                        newServer.rolesFaddishness = update.faddishness;
                        rolesUpdated = true;
                    }
                    newRoles.push(update.data);
                    break;
                }
                case "serverInfo": {
                    newServer.serverInfo = update.data;
                    newServer.serverInfoLastModified = update.lastModified;
                    newServer.serverInfoFaddishness = update.faddishness;
                    break;
                }
                case "permission": {
                    if (
                        newServer.domainPermissionsLastModified < update.lastModified ||
                        (newServer.domainPermissionsLastModified === update.lastModified &&
                            newServer.domainPermissionsFaddishness < update.faddishness)
                    ) {
                        newServer.domainPermissionsLastModified = update.lastModified;
                        newServer.domainPermissionsFaddishness = update.faddishness;
                        permissionsUpdated = true;
                    }

                    newPermissions.push(update.data);
                    break;
                }
                case "channel": {
                    if (
                        newServer.channelsLastModified < update.lastModified ||
                        (newServer.channelsLastModified === update.lastModified &&
                            newServer.channelsFaddishness < update.faddishness)
                    ) {
                        newServer.channelsLastModified = update.lastModified;
                        newServer.channelsFaddishness = update.faddishness;
                        channelsUpdated = true;
                    }

                    newChannels.push(update.data);
                    break;
                }
                case "activeChannel": {
                    if (
                        newServer.activeChannelsLastModified < update.lastModified ||
                        (newServer.activeChannelsLastModified === update.lastModified &&
                            newServer.activeChannelsFaddishness < update.faddishness)
                    ) {
                        newServer.activeChannelsLastModified = update.lastModified;
                        newServer.activeChannelsFaddishness = update.faddishness;
                    }
                    if (newActiveChannels === undefined) {
                        newActiveChannels = { ...server.activeChannels };
                    }
                    newActiveChannels[update.data.channelID] = update.data;
                    break;
                }
                case "user": {
                    if (
                        newServer.usersLastModified < update.lastModified ||
                        (newServer.usersLastModified === update.lastModified &&
                            newServer.channelsFaddishness < update.faddishness)
                    ) {
                        newServer.usersLastModified = update.lastModified;
                        newServer.usersFaddishness = update.faddishness;
                    }
                    if (newUsers === undefined) {
                        newUsers = { ...newServer.users };
                        newServer.users = newUsers;
                    }
                    const user = update.data;
                    newUsers[user.userID] = user;
                    if (user.userID === newServer.userID) {
                        const localID = info.localUserID;

                        // We just received information about the user we are currently using.
                        // We might want to download it.
                        const currentProfile = getLocalProfile(localID);
                        const currentTimestamp = currentProfile.profileData.timestamp;
                        if (currentTimestamp < user.profileTimestamp) {
                            fetchLocalProfile(localID, newServer.serverID, user);
                        } else if (currentTimestamp > user.profileTimestamp) {
                            // TODO: Send a newer profile to the server!
                        }
                    }
                    break;
                }
                default:
                    console.error("unknown update type:", update.type);
            }
        }

        for (const update of messageUpdates) {
            // TODO: This code is nothing to be proud of. Perhaps it could be simplified if chunks existed outside of their rooms?
            // I do not like that we must collect the message updates to their own place in order to make sure that they run after room updates.
            if (update.type !== "message") {
                continue;
            }
            if (newRooms === undefined) {
                // Copy the existing rooms. This update did not redefine the room list.
                newRooms = { ...server.rooms };
            }
            const { roomID, chunkID, messageIndex } = update.data;
            const currentRoom = newRooms[roomID] || defaultRoom;

            const newChunk = {
                ...(currentRoom.chunks[chunkID] || defaultTextChunk),
            };

            const newMessages = [...newChunk.messages];
            newMessages[messageIndex] = update.data;
            newChunk.messages = newMessages;

            if (
                newChunk.lastModified < update.lastModified ||
                (newChunk.lastModified == update.lastModified && newChunk.faddishness < update.faddishness)
            ) {
                newChunk.lastModified = update.lastModified;
                newChunk.faddishness = update.faddishness;
            }

            newRooms[roomID] = {
                ...currentRoom,
                chunks: {
                    ...currentRoom.chunks,
                    [chunkID]: newChunk,
                },
            };
        }

        if (rolesUpdated) {
            newServer.roles = newRoles;
        }

        if (newRooms) {
            newServer.rooms = newRooms;
        }

        if (permissionsUpdated) {
            newServer.domainPermissions = newPermissions;
        }

        if (channelsUpdated) {
            newServer.channels = newChannels;
        }

        if (newActiveChannels) {
            newServer.activeChannels = newActiveChannels;
        }

        return newStore;
    }
);

export const serverAddMessageToQueue = mainStore.createAction(
    "server/messageQueue/add",
    modifyServer((_, server, message: Immutable<UnsentMessage>) => ({
        ...server,
        messageQueue: [...server.messageQueue, message],
    }))
);

export const setServerMessageQueue = mainStore.createAction(
    "server/messageQueue/set",
    modifyServer((_, server, mq: UnsentMessage[]) => ({
        ...server,
        messageQueue: mq,
    }))
);

export const serverRemoveMessageFromQueue = mainStore.createAction(
    "server/messageQueue/remove",
    modifyServer((_, server, idempotence: string) => ({
        ...server,
        messageQueue: server.messageQueue.filter((m) => m[0].idempotence !== idempotence),
    }))
);

export function parseServerURL(url: string): URL {
    if (url.indexOf(":/") === -1) {
        url = "https://" + url;
    }
    return new URL(url);
}

function urlToConnectivityInfo(store: Immutable<MainStore>, url: string, localUserID?: string): ListedServer {
    if (localUserID === undefined) {
        for (const clientUserID in store.clientUsers) {
            localUserID = clientUserID;
        }
        if (localUserID === undefined) {
            // TODO: Proper error
            throw "can not connect to a server without a user";
        }
    }
    const info = {
        url: parseServerURL(url).href,
        deviceID: "",
        sessionToken: "",
        sessionID: "",
        localUserID,
        enabled: true,
    };

    return info;
}

export const addServer = mainStore.createAction("servers/add", (store, ip: string, localUserID?: string) => {
    const id = `${store.nextServerID}`;
    const nextServerID = store.nextServerID + 1;
    return {
        ...store,
        nextServerID,
        listedServers: {
            ...store.listedServers,
            [id]: urlToConnectivityInfo(store, ip, localUserID),
        },
        servers: {
            ...store.servers,
            [id]: {
                ...defaultServer,
                serverID: id,
            },
        },
    };
});

const addMissingServers = mainStore.createAction("servers/addMissing", (store) => {
    const servers = { ...store.servers };
    for (const serverID in store.listedServers) {
        if (servers[serverID] === undefined) {
            servers[serverID] = {
                ...defaultServer,
                serverID,
            };
        }
    }
    return {
        ...store,
        servers,
    };
});

export const setServerConnectivityInfoTokenAndID = mainStore.createAction(
    "listsedServers/info/set",
    (store: Immutable<MainStore>, serverID: string, sessionID: string, sessionToken: string) => {
        const current = store.listedServers[serverID];
        if (
            current === undefined ||
            (sessionID === current.sessionID && sessionToken === current.sessionToken)
        ) {
            // If we have not loaded yet.
            // Or if sessionID is the same, then we just do nothing as to
            // not cause an unnecessary update.
            return store;
        }
        return {
            ...store,
            listedServers: {
                ...store.listedServers,
                [serverID]: {
                    ...current,
                    sessionID,
                    sessionToken,
                },
            },
        };
    }
);

export const setVoiceInputAudioDevice = mainStore.createAction(
    "voice/inputAudioDevice/set",
    (store, inputAudioDevice: MediaDeviceInfo | undefined) => ({
        ...store,
        voice: {
            ...store.voice,
            inputAudioDevice: inputAudioDevice && inputAudioDevice.toJSON(), // TODO: Should this be validated?
        },
    })
);

const setAudioLevels = mainStore.createAction("audioLevels/set", (store, audioLevels: AudioLevels) => ({
    ...store,
    audioLevels,
}));

const addListedServers = mainStore.createAction(
    "listedServers/set",
    (store, listedServers: Record<string, ListedServer>) => {
        return {
            ...store,
            listedServers: {
                ...store.listedServers,
                ...listedServers,
            },
        };
    }
);

const setNextServerID = mainStore.createAction("nextServerID/set", (store, nextServerID: number) => ({
    ...store,
    nextServerID,
}));

export const addClientUser = mainStore.createAction("clientUsers/add", (store, clientUser: ClientUser) => ({
    ...store,
    clientUsers: {
        ...store.clientUsers,
        [clientUser.localID]: clientUser,
    },
}));

export const clientUserAddMainIdentityKey = mainStore.createAction(
    "clientUsers/addMainIdentityKey",
    (
        store,
        localID: string,
        username: string,
        encryptedIdentityKey: string,
        keyIV: string,
        publicKeyRaw: string
    ) => {
        const existingClientUser = store.clientUsers[localID];
        if (existingClientUser === undefined) {
            throw "unknown localID";
        }
        if (!("missing" in existingClientUser.mainIdentifier && existingClientUser.mainIdentifier.missing)) {
            throw "mainIdentifier already assigned to " + localID;
        }
        return {
            ...store,
            clientUsers: {
                ...store.clientUsers,
                [localID]: {
                    ...existingClientUser,
                    mainIdentifier: {
                        ecdsaIdentity: {
                            username,
                            publicKeyRaw,
                            encryptedIdentityKey,
                            encryptedIdentityKeyIV: keyIV,
                        },
                    },
                },
            },
        };
    }
);

const setClientUsers = mainStore.createAction(
    "clientUsers/set",
    (store, clientUsers: Record<string, ClientUser>) => {
        return {
            ...store,
            clientUsers,
        };
    }
);

export const rememberEndToEndKey = mainStore.createAction(
    "endToEndEncryptionKeys/add",
    (store, fingerprint: string, encryptedEndToEndKey: string, keyIV: string, salt: string) => {
        return {
            ...store,
            endToEndEncryptionKeys: {
                ...store.endToEndEncryptionKeys,
                [fingerprint]: {
                    encryptedKey: encryptedEndToEndKey,
                    fingerprint,
                    iv: keyIV,
                    salt,
                },
            },
        };
    }
);

export const addToast = mainStore.createAction("toasts/add", (store, toast: Toast) => ({
    ...store,
    toasts: [...store.toasts, toast],
}));

registerDebugCommand("addToast", addToast);

export const dismissToast = mainStore.createAction("toasts/remove", (store, toastID: string) => ({
    ...store,
    toasts: store.toasts.filter((t) => t.id !== toastID),
}));

export const setDevicePermissionState = mainStore.createAction(
    "permissions/set",
    (store, permission: DevicePermission, state: PermissionState) => ({
        ...store,
        permissions: {
            ...store.permissions,
            [permission]: state,
        },
    })
);

function onChange<T>() {
    // We use function currying as a hack for the fact
    // that TypeScript doesn't support just specifying
    // some of the type arguments.
    return function onChangeImpl<K extends keyof T>(key: K) {
        const NOT_KNOWN = {};
        let value: Immutable<T[K]> | Record<string, never> = NOT_KNOWN;
        return (store: Immutable<T>) => {
            const newValue = store[key];
            const changed = newValue !== value && value !== NOT_KNOWN;
            value = newValue;
            return changed;
        };
    };
}

const mainStoreChange = onChange<MainStore>();
const nextServerIDChanged = mainStoreChange("nextServerID");
const listedServersChanged = mainStoreChange("listedServers");
const clientUsersChanged = mainStoreChange("clientUsers");
const audioLevelsChanged = mainStoreChange("audioLevels");
const miscConfigChanged = mainStoreChange("miscConfig");
const voiceChanged = mainStoreChange("voice");

//const keyBindingsChanged = onChange(defaultStore.miscConfig, 'keyBindings')

export let currentDefaultMediaVolume = 1;

function createDefaultProfiles(clientUsers: Immutable<Record<string, ClientUser>>) {
    for (const localID in clientUsers) {
        const clientUser = clientUsers[localID];
        if (clientUser === undefined) {
            continue;
        }
        const localProfile = getLocalProfile(clientUser.localID);
        if (localProfile.profileData.timestamp !== 0) {
            // Local profile already loaded.
            continue;
        }

        const mainAuth = clientUser.mainIdentifier;
        if (mainAuth === undefined || !("ecdsaIdentity" in mainAuth)) {
            // Can't sign so no point in continuing.
            continue;
        }

        let userName = clientUser.centralUsername;
        if (userName === undefined) {
            if (mainAuth.ecdsaIdentity) {
                userName = mainAuth.ecdsaIdentity.username;
            } else {
                // We could not get a good username.
                // So no point in creating a default profile.
                continue;
            }
        }

        insertLocalProfile(
            localID,
            {
                userName: userName,
                timestamp: VALID_PROFILE_START_DATE - 1,
            },
            mainAuth
        );
    }
}

// TODO: This flag is kinda ugly...
let saveMiscConfigIgnoreHack = true;

export async function handleStoreChanged(s: Immutable<MainStore>) {
    //console.trace('hello!')
    currentDefaultMediaVolume = s.miscConfig.mediaVolume;
    if (loadStates["nextServerID"] === LoadProgress.LOADED) {
        if (nextServerIDChanged(s)) {
            await savePersistent("nextServerID", s.nextServerID);
        }
    } else if (loadStates["nextServerID"] !== LoadProgress.LOADING) {
        await setNextServerID(await loadPersistent("nextServerID", 0));
    }

    if (loadStates["serverList"] === LoadProgress.LOADED) {
        if (listedServersChanged(s)) {
            await savePersistent("serverList", s.listedServers);

            for (const serverID in s.listedServers) {
                if (s.servers[serverID] === undefined) {
                    await addMissingServers();
                    break;
                }
            }
        }
    } else if (loadStates["serverList"] !== LoadProgress.LOADING) {
        await addListedServers(await loadPersistent("serverList", {}));
        await addMissingServers();
    }

    if (loadStates["clientUsers"] === LoadProgress.LOADED) {
        if (clientUsersChanged(s)) {
            createDefaultProfiles(s.clientUsers);
            await savePersistent("clientUsers", s.clientUsers);
        }
    } else if (loadStates["clientUsers"] !== LoadProgress.LOADING) {
        await setClientUsers(await loadPersistent("clientUsers", {}));
    }

    if (loadStates["miscConfig"] === LoadProgress.LOADED) {
        if (miscConfigChanged(s) && saveMiscConfigIgnoreHack) {
            await savePersistent("miscConfig", s.miscConfig);
        }
        if (changelog.length > s.miscConfig.changelogIndex) {
            setPopup({ showChangelog: true }, false);
        }
    } else if (loadStates["miscConfig"] !== LoadProgress.LOADING) {
        await setMiscConfig({
            ...defaultMiscConfig, // Insert new settings as well.
            ...(await loadPersistent("miscConfig", defaultMiscConfig)),
            loaded: true,
        });
    }

    if (loadStates["voice"] === LoadProgress.LOADED) {
        if (voiceChanged(s)) {
            await savePersistent("voice", s.voice);
        }
    } else if (loadStates["voice"] !== LoadProgress.LOADING) {
        await setVoice({
            ...(await loadPersistent("voice", defaultVoiceConfig)),
            pushToTalkPressed: false,
            activeServerID: "",
        });
    }

    if (loadStates["audioLevels"] === LoadProgress.LOADED) {
        if (audioLevelsChanged(s)) {
            await savePersistent("audioLevels", s.audioLevels);
        }
    } else if (loadStates["audioLevels"] !== LoadProgress.LOADING) {
        await setAudioLevels(await loadPersistent("audioLevels", {}));
    }
}

export async function forceCentralAutoUpdateNow() {
    // Toggle the auto-updater on-and-off to force an auto-update check!
    // Persistency for miscConfig is also disabled during this time to
    // prevent unnecessary writes.
    // TODO: This is probably the very definition of a 'hack'.
    // TODO: Does this even work still with the new store implmentation?
    saveMiscConfigIgnoreHack = false;
    await toggleCentralAutoUpdate();
    await toggleCentralAutoUpdate();
    saveMiscConfigIgnoreHack = true;
}

// TODO: Either reimplement or remove.
//;(window as any).debugAuthenticate = async (
//    chainPEM: string,
//    privateKeyPKCS8PEM: string,
//    addServerIP?: string
//) => {
//    try {
//        const privateKey = await importPKCS8PEM(privateKeyPKCS8PEM)
//        const chain = loadCertificatesFromMultiplePEM(chainPEM)
//        const chainAsPKCS7 = chain.export('base64url')
//        const analysis = await verifyX509Chain(chain/*, []*/)
//        const publicKey = await crypto.subtle.exportKey('jwk', await exportAsSHA512(analysis.publicSessionKey, 'verify'))
//        await ensurePrivateMatchesPublicKey(privateKey, publicKey)
//        await addClientUser({
//            authMethods: [{
//                type: AuthMethodNames.X509_RSA_PKI,
//                chain: chainAsPKCS7,
//                privateKey,
//                publicKey,
//            }],
//            localID: analysis.authID,
//        })
//        console.log('%csuccessfully authenticated: %s', 'color: green;', analysis.authID)
//    } catch (e) {
//        console.error(e)
//    }
//
//    if (addServerIP) {
//        addServer(addServerIP)
//    }
//}
