import { loadPersistent, savePersistent, loadStates, LoadProgress } from "./db";
import {
    setServerConnectivityInfo,
    updateServerProvision,
    defaultServer,
    setServerViewedRoomID,
    UNLOADED_SERVER_LIST,
    defaultStore,
} from "./store";
import { navigateTo, navigationStatusStore, pageToServerID } from "./routes";
import type { NavigationStatus } from "./routes";

// TODO: Most forms of authentication should be disallowed over http. Only https should be allowed here.

import type { MainStore, ClientUser, Server, ListedServer } from "./store";

import { asMutable } from "./immutable";
import type { Immutable } from "./immutable";

import {
    setServerMessageQueue,
    serverRemoveMessageFromQueue,
    ingestUpdates,
    addServer,
    parseServerURL,
    addClientUser,
} from "./acts";
import {
    appVersion,
    autoJoinURL,
    autoViewRoomID,
    defaultNotificationServerURL,
    isElectron,
    joinAnonymously,
} from "./options";

import {
    updateObjects,
    serverToClientProvision,
    messageFromSFU,
    messageAttachmentIdempotence,
    profileUploadURL,
    toRadix64,
} from "./schema";
import { getLocalProfile, getServerProfile, localProfilesModified, setProfileFetcher } from "./profiles";
import type { Profile } from "./profiles";
import { handleSFUMessage } from "./call";
import { getServerAuthenticatedURL, onServer } from "./actions";
import { handleAttachmentURL, sendMessageAction } from "./message_sender";
import { randomBase64 } from "./encoding_schemes";
//import { parseX509Chain, verifyX509Chain } from './x509_chains' // TODO: Only required because we must find session and user. In the future, central server can just give us this with the JWT
import { createServerNotificationToken } from "./notifications";
import { safeURL } from "./join_url";
import { registerDebugCommand } from "./debug_mode";

let navigationStatus: NavigationStatus;

// TODO: Add instance locking to servers such that we don't get two browser windows fighting over control.

const seenClientVersions: Record<string, boolean> = {};

let currentMainStore: Immutable<MainStore> = defaultStore;

//export function isOlder(a: TimestampComparable, b: TimestampComparable) {
//    return a.lastModified < b.lastModified || (a.lastModified === b.lastModified && a.faddishness < b.faddishness)
//}

function createReceivedVersions(
    server: Immutable<Server>,
    isViewedServer: boolean,
    reloadRooms: boolean,
    _reloadChannels: boolean // TODO: Is this still needed?
): string {
    const serverInfo = `${toRadix64(server.serverInfoLastModified)}.${toRadix64(server.serverInfoFaddishness)}.serverInfo`;
    const roomsInfo = `${reloadRooms ? "" : toRadix64(server.roomsLastModified)}.${toRadix64(server.roomsFaddishness)}.rooms`;
    const rolesInfo = `${toRadix64(server.rolesLastModified)}.${toRadix64(server.rolesFaddishness)}.roles`;
    const permissionsInfo = `${toRadix64(server.domainPermissionsLastModified)}.${toRadix64(server.domainPermissionsFaddishness)}.permissions`;
    const channelsInfo = `${toRadix64(server.channelsLastModified)}.${toRadix64(server.channelsFaddishness)}.channels`;
    const activeChannels = `${toRadix64(server.activeChannelsLastModified)}.${toRadix64(server.activeChannelsFaddishness)}.activeChannels`;
    const usersInfo = `${toRadix64(server.usersLastModified)}.${toRadix64(server.usersFaddishness)}.users`;
    let versionStr = `${serverInfo}~${roomsInfo}~${rolesInfo}~${permissionsInfo}~${channelsInfo}~${activeChannels}~${usersInfo}`;

    const room = server.rooms[server.viewedRoomID];
    if (isViewedServer && room && server.viewedRoomID !== -1) {
        for (let i = 0; i < room.chunksWanted; i++) {
            const chunkID = room.chunksStart + i;
            const chunk = room.chunks[chunkID];
            const lastModified = toRadix64(chunk ? chunk.lastModified : 0);
            const faddishness = toRadix64(chunk ? chunk.faddishness : -1);
            versionStr += `~${lastModified}.${faddishness}.chunk.${toRadix64(server.viewedRoomID)}.${toRadix64(chunkID)}`;
        }
    }

    return versionStr;
}

class NetConnection {
    socket: EventSource;
    serverID: string;
    isViewed: boolean;
    closed = false;
    oldReceivedVersions = "";
    oldGlobalUserPermissions: Record<string, boolean> = {};
    oldRoleAssignmentsString = "";
    shouldSendOldMessages = false;
    sessionNumber = 0;

    /** What profile to send the server. */
    newestProfile: Profile | undefined = undefined;

    /**
     * If this doesn't match the current value of userID for the server,
     * we abort the profile upload.
     */
    newestProfileUserID = "";

    /**
     * From where to fetch new profiles.
     */
    profilesURL = "";

    constructor(serverID: string, clientUser: Immutable<ClientUser>, initialConnectivityInfo: ListedServer) {
        this.isViewed = pageToServerID(navigationStatus) === serverID;

        // TODO: use real value here.
        const socket = new EventSource(getServerAuthenticatedURL(initialConnectivityInfo, "updates"));

        this.socket = socket;
        this.serverID = serverID;

        console.log("attempting connection");

        let enterReconnectLoop = true;

        socket.addEventListener("open", () => {
            console.log("connection established");
            onServer.userIsActive0(serverID);
            this.shouldSendOldMessages = true;
        });

        socket.addEventListener("error", async (event) => {
            console.error("could not connect");
            console.log(event);

            // Only run one reconnect loop at the time.
            if (!enterReconnectLoop) {
                return;
            }

            // Unregister us as the correct netcode for this server.
            this.close();

            let timeout = 1000;

            try {
                enterReconnectLoop = false;

                // As long as we have not found anything better we loop.
                while (instances[serverID] && instances[serverID].net === undefined) {
                    try {
                        await onServer.pong0(serverID);
                    } catch (_e) {
                        console.log("next reconnect after", timeout);
                        await new Promise((ok) => setTimeout(ok, timeout));

                        // Double the timeout each time.
                        // TODO: Once we change it so that we only try to connect to active voice server and viewed server we could remove the increasing timeout.
                        timeout *= 2;
                        continue;
                    }
                    break;
                }
            } finally {
                enterReconnectLoop = true;

                // Immediate reconnect.
                const instance = instances[serverID];
                if (instance && instance.net === undefined) {
                    connectivityInfoChanged(instance, currentMainStore);
                }
            }
        });

        socket.addEventListener("update0", async (event) => {
            const updates = JSON.parse(event.data);
            const u = updateObjects.parse(updates);
            await ingestUpdates(this.serverID, u);
        });

        socket.addEventListener("sessionNumber0", (n) => {
            this.sessionNumber = parseInt(n.data);
            const server = currentMainStore.servers[serverID];
            if (!server) {
                return;
            }
            this.tryResendOldMessages(server);
            this.oldReceivedVersions = "";
            this.sendReceivedVersions(server, false);
        });

        socket.addEventListener("sfuMessage0", async (event) => {
            const message = JSON.parse(event.data);
            const m = messageFromSFU.parse(message);
            handleSFUMessage(serverID, m);
        });

        socket.addEventListener("newAttachmentURL0", async (event) => {
            const message = JSON.parse(event.data);
            const m = messageAttachmentIdempotence.parse(message);
            handleAttachmentURL(serverID, m);
        });

        socket.addEventListener("newProfileURL0", async (event) => {
            const message = JSON.parse(event.data);
            const m = profileUploadURL.parse(message);
            const server = currentMainStore.servers[this.serverID];
            const profile = this.newestProfile;
            if (
                server === undefined ||
                profile === undefined ||
                m.userID !== server.userID ||
                m.userID !== this.newestProfileUserID ||
                m.profileTimestamp !== profile.profileData.timestamp
            ) {
                return;
            }
            await fetch(m.uploadURL, {
                method: "PUT",
                // TODO: Perhaps just using arrayBuffer directly would be better
                body: new File([profile.arrayBuffer], "profile.png"),
            });
            if (
                m.userID !== server.userID ||
                m.userID !== this.newestProfileUserID ||
                m.profileTimestamp !== profile.profileData.timestamp
            ) {
                return;
            }
            await onServer.setProfile0(this.serverID, profile.profileData.timestamp);
        });

        socket.addEventListener("giveNotificationToken0", async (_event) => {
            if (!("ecdsaIdentity" in clientUser.mainIdentifier)) {
                return;
                // TODO: Implement for other types as well, such as guest users.
            }

            const user = clientUser.mainIdentifier.ecdsaIdentity.publicKeyRaw;
            const session = clientUser.localID; // This works well enough. Ideally localID would be username+sessionID anyway.

            const url = initialConnectivityInfo.url;
            console.error("give notification token with:", user, session);
            const token = await createServerNotificationToken(user, session, url);
            console.error("the notification token is:", token);
            if (token === "") {
                console.error("the notification token was empty");
                return;
            }
            await onServer.addNotificationToken0(this.serverID, defaultNotificationServerURL, token);
        });

        socket.addEventListener("provision0", async (event) => {
            const provision = JSON.parse(event.data);
            const p = serverToClientProvision.parse(provision);
            this.profilesURL = p.profilesURL;
            await updateServerProvision(this.serverID, p);
            // TODO: Inform actions.ts about the supportedActions!
        });
        registerDebugCommand("socket", () => socket);
    }
    close() {
        console.warn("server closed");
        this.closed = true;
        this.socket.close();
        const instance = instances[this.serverID];
        if (instance && instance.net === this) {
            instance.net = undefined;
        }
    }
    profileChanged = async (profile: Profile) => {
        this.newestProfile = profile;
    };
    sendReceivedVersions(server: Immutable<Server>, acknowledgeUpdate: boolean) {
        let reloadRooms = false;
        let reloadChannels = false;
        if (
            this.oldGlobalUserPermissions !== server.globalUserPermissions ||
            this.oldRoleAssignmentsString !== server.roleAssignmentsString
        ) {
            // We could detect the change by waiting for changes in handleServerToClientUpdate instead
            // TODO: Would that be better?

            // TODO: Here is another idea, we could move out permissions into their own object

            //console.log('global user permissions changed:', server.globalUserPermissions, this.oldRoleAssignmentsString, server.roleAssignmentsString)

            // Check if permission MIGHT have been changed.
            const permissionChanged = (name: string) => {
                return (
                    this.oldRoleAssignmentsString !== server.roleAssignmentsString ||
                    this.oldGlobalUserPermissions[name] !== server.globalUserPermissions[name]
                );
            };
            reloadRooms = permissionChanged("read_chat") || permissionChanged("edit_roles");
            reloadChannels = permissionChanged("join_channel") || permissionChanged("edit_roles");
            this.oldGlobalUserPermissions = server.globalUserPermissions;
            this.oldRoleAssignmentsString = server.roleAssignmentsString;
        }

        const receivedVersions = createReceivedVersions(server, this.isViewed, reloadRooms, reloadChannels);
        console.warn("receivedVersions:", receivedVersions);

        if (this.socket.readyState !== this.socket.OPEN) {
            return;
        }

        const forceSync = this.oldReceivedVersions !== receivedVersions;

        if (!forceSync && !acknowledgeUpdate) {
            // No point in sending this request if we are not either acknowledging or forcing a resynch.
            return;
        }

        onServer.acknowledgeUpdates0(this.serverID, this.sessionNumber, receivedVersions, forceSync);
        this.oldReceivedVersions = receivedVersions;
    }
    async tryResendOldMessages(server: Immutable<Server>) {
        if (
            this.shouldSendOldMessages &&
            loadStates["messageQueue." + this.serverID] == LoadProgress.LOADED
        ) {
            // Only start sending old messages once the
            // connection is established.

            this.shouldSendOldMessages = false;
            for (const unsent of server.messageQueue) {
                sendMessageAction(this.serverID, asMutable(unsent[0]), asMutable(unsent[1]));
            }
        }
    }
    serverChanged(server: Immutable<Server>, oldServer: Immutable<Server>) {
        if (server.forcedUpdateAttempts !== oldServer.forcedUpdateAttempts) {
            this.sendReceivedVersions(server, true);
        }
        this.tryResendOldMessages(server);
    }
}

// TODO: A lot of this could be simplified if all connectivityInfo was loaded at once.
type NetConnectionAndConnectivityInfo = {
    info: ListedServer;
    clientUser?: Immutable<ClientUser>;
    net?: NetConnection;
    serverID: string;
    needsSaveMessageQueue: boolean;
    messageQueueID: string;
};

const instances: Record<string, NetConnectionAndConnectivityInfo> = {};

async function httpProfileLoader(serverID: string, userID: string, profileTimestamp: number) {
    const instance = instances[serverID];
    if (instance === undefined || instance.net === undefined || instance.net.profilesURL === "") {
        return undefined;
    }
    const urlResolver = safeURL(instance.net.profilesURL);
    const profileURL = urlResolver(`${userID}/${profileTimestamp}.png`);
    const response = await fetch(profileURL);
    const data = await response.blob();
    return data;
}

// TODO: Refactor
export function serverNetCodeSubscribe() {
    seenClientVersions[appVersion] = true;
    window.addEventListener("beforeunload", (event) => {
        // Disconnect from all servers before unloading the page.
        // This prevents errors being shown during a reload.
        // It is also a politer behaviour towards the servers.
        for (const id in instances) {
            const instance = instances[id];
            if (!instance || !instance.net) {
                continue;
            }
            instance.net.close();
            instance.net = undefined;
        }

        // So that nobody accidentally leaves.
        // TODO: Perhaps this shouldn't always be called. There might be many cases where the user won't lose anything important and won't be annoyed by having to reload

        if (!isElectron) {
            // Electron has no popup. And automatically assumes that the user should not be allowed to leave.
            // But in Electron, the user can't leave. If we call this in Electron the only thing it would achieve is
            // prevent Ctrl+R. Which is annoying since Ctrl+R is a nice keyboard shortcut.
            event.preventDefault();
        }
    });
}

// Type guards can be expressed in jsdoc, don't worry.
function isOkClientUser(clientUser?: Immutable<ClientUser>): clientUser is Immutable<ClientUser> {
    return (
        clientUser !== undefined &&
        clientUser.mainIdentifier !== undefined &&
        !("missing" in clientUser.mainIdentifier)
    );
}

function connectivityInfoChanged(instance: NetConnectionAndConnectivityInfo, store: Immutable<MainStore>) {
    const clientUser = store.clientUsers[instance.info.localUserID];

    // Store it such that we may detect changes to it.
    instance.clientUser = clientUser;

    if (instance.info.enabled) {
        if (instance.info.deviceID === "") {
            // TODO: Perhaps there is a cleaner way to ensure that token is always
            // set to something.
            setServerConnectivityInfo(instance.serverID, instance.info);
            return;
        }

        if (isOkClientUser(clientUser)) {
            // We make sure the clientUser has been loaded and has a somewhat
            // valid main identifier (i.e not missing).
            if (instance.net) {
                instance.net.close();
            }
            instance.net = new NetConnection(instance.serverID, clientUser, instance.info);
        } else {
            console.error("clientUser not loaded yet!");
            // TODO: inform in a better way
        }
    }
}

export async function handleStoreChanged(store: Immutable<MainStore>) {
    const oldStore = currentMainStore;
    currentMainStore = store;

    if (oldStore.servers !== store.servers || oldStore.listedServers !== store.listedServers) {
        // TODO: A proper removal of a server should write connectivityInfo.N to {} or something (connectivityInfo will be refactored out, ignore just this line)
        // TODO: As well as messageQueue.N (hopefully this gets refactored out as well)
        // TODO: Proper server removal should also remove the instance object...

        for (const serverID in store.listedServers) {
            const listedServer = store.listedServers[serverID];
            if (listedServer === undefined) {
                // TODO: We could assert this instead.
                continue;
            }

            const server = store.servers[serverID];
            let instance = instances[serverID];
            if (server !== undefined) {
                if (instance === undefined) {
                    instance = instances[serverID] = {
                        info: listedServer,
                        net: undefined,
                        serverID,
                        needsSaveMessageQueue: false,
                        messageQueueID: `messageQueue.${serverID}`,
                        //loaded: server.connectivityInfo.loaded,
                    };

                    // Make sure that the profile code knows how to load from this server.
                    setProfileFetcher(serverID, httpProfileLoader);

                    connectivityInfoChanged(instance, store);
                } else if (instance.info !== listedServer) {
                    if (instance.net !== undefined) {
                        instance.net.close();
                        instance.net = undefined;
                    }
                    instance.info = listedServer;
                    connectivityInfoChanged(instance, store);
                }
            }
        }
    }

    for (const serverID in instances) {
        const instance = instances[serverID]!;
        const server = store.servers[serverID];
        const newClientUser = store.clientUsers[instance.info.localUserID];
        if (newClientUser != instance.clientUser) {
            console.warn("closing server due to client user change");
            if (instance.net) {
                instance.net.close();
                instance.net = undefined;
            }
            if (isOkClientUser(newClientUser)) {
                // Reconnect if there is a point to it.
                connectivityInfoChanged(instance, store);
            }
        }
        if (server) {
            const oldServer = oldStore.servers[serverID] || defaultServer;
            if (server !== oldServer) {
                if (instance.net) {
                    instance.net.serverChanged(server, oldServer);
                }
                if (loadStates[instance.messageQueueID] === LoadProgress.LOADED) {
                    if (server.messageQueue !== oldServer.messageQueue) {
                        if (instance.needsSaveMessageQueue) {
                            await savePersistent(instance.messageQueueID, server.messageQueue);
                        } else {
                            instance.needsSaveMessageQueue = true;
                        }
                    }
                } else if (loadStates[instance.messageQueueID] !== LoadProgress.LOADING) {
                    await setServerMessageQueue(serverID, await loadPersistent(instance.messageQueueID, []));
                }
            }
        } else if (instance.net) {
            instance.net.close();
            instance.net = undefined;
        }
    }

    autoJoinServerURL();
}

function navigationStatusUpdate(n: NavigationStatus) {
    // TODO: Must update isViewedServer createReceivedVersions
    const viewedServer = pageToServerID(n);
    const viewedServerStr = `${viewedServer}`;

    for (const serverID in instances) {
        const instance = instances[serverID];
        if (!instance || !instance.net) {
            continue;
        }
        const isViewed = viewedServerStr === serverID;
        if (instance.net.isViewed !== isViewed) {
            instance.net.isViewed = isViewed;
            const server = currentMainStore.servers[instance.serverID];
            if (server === undefined) {
                continue;
            }
            instance.net.sendReceivedVersions(server, false);
        }
    }

    navigationStatus = n;
}
navigationStatusStore.subscribe(navigationStatusUpdate);

async function showCorrectServerAndRoom(serverID: string) {
    const roomID = parseInt(autoViewRoomID);
    navigateTo({ name: "main", serverID, roomID });
    if (autoViewRoomID !== "") {
        await setServerViewedRoomID(serverID, roomID);
    }
}

let tryAutoJoinServer = true;
let missingUserReported = false;

async function autoJoinServerURL() {
    // TODO: Perhaps display a popup in the future

    if (!tryAutoJoinServer) {
        return;
    }
    if (!autoJoinURL) {
        tryAutoJoinServer = false;
        return;
    }
    if (currentMainStore.listedServers === UNLOADED_SERVER_LIST) {
        return;
    }

    let url: URL;
    try {
        url = parseServerURL(autoJoinURL);
    } catch (_e) {
        tryAutoJoinServer = false;
        return;
    }

    let expectedLocalID = "";
    if (joinAnonymously) {
        expectedLocalID = "anonymous-" + url.href;
    } else {
        // TODO: Check preferences for primary user account in the future.
        for (const localID in currentMainStore.clientUsers) {
            expectedLocalID = localID;
            break;
        }
    }

    if (expectedLocalID === "") {
        if (!missingUserReported) {
            missingUserReported = true;

            // TODO: Report in a better way.
            console.error("no client to join as!");
        }
        return;
    }

    for (const serverID in currentMainStore.servers) {
        const server = currentMainStore.servers[serverID];
        if (server === undefined) {
            return;
        }
        const info = currentMainStore.listedServers[serverID];
        if (info === undefined || info.url !== url.href) {
            // Not of interest.
            continue;
        }

        // Matching URL. Disable autoJoin since the server was already added.
        tryAutoJoinServer = false;

        if (joinAnonymously && currentMainStore.clientUsers[info.localUserID] === undefined) {
            // A user with a matching local ID that this server expects has not been
            // been created yet, so create it.
            const guise64 = randomBase64(32);
            await addClientUser({
                localID: expectedLocalID,
                serverLock: [server.serverID],
                supersededBy: "",
                mainIdentifier: {
                    guest: {
                        identifier: guise64,
                    },
                },
                extraSecurity: [],
            });
        }
        await showCorrectServerAndRoom(serverID);
        return;
    }

    // First the server is added.
    // Then we wait for a store changed callback.
    // Find the added server, and potentially add a missing anonymous user
    // After that we navigate to it.
    await addServer(url.href, expectedLocalID);
}

localProfilesModified.subscribe(async function () {
    // Whenever a profile changes, we inform the servers.
    for (const serverID in instances) {
        const instance = instances[serverID]!;
        const server = currentMainStore.servers[serverID];
        if (!instance.net || !server) {
            continue;
        }

        const serverUser = server.users[server.userID];
        if (!serverUser) {
            continue;
        }

        const localProfile = getLocalProfile(instance.info.localUserID);
        const serverProfile = getServerProfile(serverID, server.userID, serverUser);
        if (localProfile.profileData.timestamp <= serverProfile.profileData.timestamp) {
            continue;
        }

        instance.net.newestProfile = localProfile;
        instance.net.newestProfileUserID = server.userID;
        await onServer.requestProfileUpload0(serverID, localProfile.profileData.timestamp);
    }
});
registerDebugCommand("netcode", () => instances);
registerDebugCommand("clearMessageQueue", () => {
    const serverID = pageToServerID(navigationStatus);
    const server = currentMainStore.servers[serverID];
    if (!server) {
        throw "select a server first";
    }
    for (const message of server.messageQueue) {
        serverRemoveMessageFromQueue(serverID, message[0].idempotence);
    }
});

// TODO: Use https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
