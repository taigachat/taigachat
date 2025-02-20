import { unlinkSync, chmodSync } from "node:fs";

import { createServer, IncomingMessage, ServerResponse } from "node:http";

import WebSocketServer from "./vendor/ws/websocket-server.js";

import config from "./config.js";

import { getLog } from "./log.ts";

import { runMigrations } from "./db.js";

import { getAttachmentUpload, getProfileUpload, randomAttachmentPrefix } from "./attachments.ts";

import { serverInfoUpdate, setServerName } from "./info.js";

import {
    createChannel,
    deleteChannel,
    joinChannel,
    mediaWorkerWebSocketConnected,
    sendMessageSFU,
    setChannelName,
    setClientMessageCallback,
    setVoiceSelfDeafen,
    setVoiceSelfMute,
    setVoiceTalking,
    channelUpdates,
    activeChannelUpdates,
} from "./channels.js";

import {
    createMessage,
    createRoom,
    deleteRoom,
    editMessage,
    setRoomDescription,
    setRoomName,
    unveilMessageAttachment,
    roomUpdates,
    chunkUpdates,
    deleteAnyMessage,
    deleteOwnMessage,
    setRoomEncryptedBy,
} from "./rooms.ts";

import {
    createRole,
    deleteRole,
    giveServerRole,
    revokeServerRole,
    setServerRoleName,
    setDomainPermission,
    swapRolePenalty,
    unitTest as rolesUnitTest,
    ensureDefaultRoles,
    roleUpdates,
    clearDomainPermissions,
} from "./roles.js";

import {
    loginWithTransfers,
    userChangesProfile,
    userGoesOffline,
    userGoesOnline,
    userUpdates,
    userWasActive,
} from "./users.js";

/**
 * @import {
 *  ActionData,
 *  ActionsKey,
 *  AuthFailure,
 *  CombinedAuthMethod,
 *  MessageActionAttachment,
 *  MessageAttachment,
 *  MessageAttachmentIdempotence,
 *  ProfileUploadURL,
 *  ServerToClientProvision,
 *  UpdateObjectVariants,
 *  VoiceState,
 *  UpdateObject,
 *  ActionRequest,
 * } from './schema.js'
 */

import { actionRequest, actionsData } from "./schema.ts";

/**
 * @import {
 *  VersionIdentifier
 * } from './updater.js'
 */

import { nthVersionSegment, parseReceivedVersions, updateAllUsers } from "./updater.js";

/**
 * @import WebSocket from './vendor/ws/websocket.js'
 */

import { createBuckets, getBucketURL, startS3 } from "./s3.ts";
import { addNotificationToken, sendNotification } from "./notifications.js";
import { scheduleSync, setSyncHandler } from "./last_modified.js";
import {
    channelAllows,
    definedPermissions,
    PERM_CLEAN_CHAT,
    PERM_EDIT_CHANNELS,
    PERM_EDIT_CHAT,
    PERM_EDIT_ROLES,
    PERM_EDIT_ROOMS,
    PERM_EDIT_SERVER_INFO,
    PERM_JOIN_CHANNEL,
    PERM_READ_CHAT,
    PERM_RENAME_ROOM,
    PERM_RETRACT_CHAT,
    PERM_WRITE_CHAT,
    permissionUpdates,
    roomAllows,
    serverAllows,
} from "./permissions.js";
import { getPublicSaltString, randomNonce, randomString } from "./auth.js";

const { error, info } = getLog("server");

// TODO: Reimplement suggest update feature (perhaps send via provisions)
const NEWEST_CLIENT_VERSION = "0.3.1";

/**
 * @param {string} version
 */
function acceptableVersion(version) {
    if (typeof version !== "string") {
        return false;
    }
    const [majorVersionStr, minorVersionStr, _patchVersion] = version.split(".");
    const majorVersion = parseInt(majorVersionStr || "");
    const minorVersion = parseInt(minorVersionStr || "");

    if (majorVersion === 0) {
        if (minorVersion >= 3) {
            return true;
        } else {
            return false;
        }
    } else {
        return true;
    }
}

class MissingAuth {
    /** @type {AuthFailure} */
    authFailure;

    /**
     * @param {AuthFailure} authFailure
     */
    constructor(authFailure) {
        this.authFailure = authFailure;
    }
}

const INVALID_SESSION = "";

class Session {
    /** @type {ServerResponse|undefined} */
    currentSSE = undefined;

    synchronizationCount = 0;
    sessionNumber = 0;

    /** @type {NodeJS.Timeout|undefined} */
    leaveVoiceChannelTimer = undefined;

    // Authentication
    userID = INVALID_SESSION; // TODO: duplicates info from voiceState, fix?

    /** @type {VersionIdentifier[]} */
    parsedVersions = [];

    /** @type {UpdateObject[]} */
    pendingUpdates = [];

    /** @type {boolean} */
    updatesAcknowledged = false;

    /** @type {Map<string, MessageAttachmentIdempotence | ''>} */
    chatMessages = new Map();

    // VC stuff.
    /** @type {VoiceState} */
    voiceState;

    // Anti DOS
    failedLoginAttempts = 0;
    blocked = false;

    /**
     * @param {number} sessionID
     * @param {string} expectedAuthID
     */
    constructor(sessionID, expectedAuthID) {
        this.sessionID = sessionID;
        this.expectedAuthID = expectedAuthID;
        this.sessionToken = randomString(); // TODO: Make sure that this is always sufficiently long. And safe!
        this.voiceState = {
            selfMute: false,
            selfDeafen: false,
            talking: false,
            channelID: -1,
            peerID: sessionID,
            userID: INVALID_SESSION,
            connected: false,
        };
    }
}

/** @type {Map<string, number>} */
const sessionByDeviceID = new Map();

/** @type {Map<string, string>} */
const nonceByDeviceID = new Map();

/** @type {(Session|undefined)[]} */
const sessionsBySessionID = new Array();

/**
 * @param {MessageActionAttachment} [attachment]
 * @returns {Promise<{uploadURL: string, messageAttachment: MessageAttachment|undefined}>}
 */
async function prepareAttachment(attachment) {
    if (!attachment) {
        return { uploadURL: "", messageAttachment: undefined };
    }

    // TODO: Make sure attachmentName is safe!
    const fileName = randomAttachmentPrefix() + attachment.name;
    const uploadURL = await getAttachmentUpload(fileName);
    info("uploadURL:", uploadURL);

    return {
        uploadURL,
        messageAttachment: {
            fileName,
            name: attachment.name,
            height: attachment.height,
            mime: attachment.mime,
        },
    };
}

/**
 * @param {Session} session
 * @param {MessageAttachmentIdempotence | ''} idempotence
 */
function sendAttachmentIdempotence(session, idempotence) {
    if (idempotence === "") {
        // Empty string means message was uploaded without an attachment -
        // therefore we do not send a special idempotence reply.
        return;
    }
    if (session.currentSSE) {
        // TODO: Encapsulate all currentSSE actions into a function.
        session.currentSSE.write(
            utf8Encoder.encode(`event: newAttachmentURL0\r\ndata: ${JSON.stringify(idempotence)}\r\n\r\n`)
        );
    }
}

/**
 * @param {Session} session
 * @param {string} uploadURL
 * @param {number} profileTimestamp
 */
function sendProfileUploadURL(session, uploadURL, profileTimestamp) {
    /** @type {ProfileUploadURL} */
    const data = {
        uploadURL,
        userID: session.userID,
        profileTimestamp,
    };
    if (session.currentSSE) {
        session.currentSSE.write(
            utf8Encoder.encode(`event: newProfileURL0\r\ndata: ${JSON.stringify(data)}\r\n\r\n`)
        );
    }
}

/** @typedef {{[ActionName in ActionsKey]?: (s: Session, ...data: ActionData<ActionName>) => void | Promise<void> }} ActionHandlers */
/** @type {ActionHandlers} */
const actions = {};

actions.userIsActive0 = ({ userID }) => {
    info("user is now active");
    // TODO: This seems like a bad name tbh.
    userWasActive(userID);
};

actions.addNotificationToken0 = ({ userID }, endpoint, token) => {
    addNotificationToken(userID, endpoint, token);
};

actions.setVoiceMute0 = ({ voiceState }, selfMute, talking) => {
    setVoiceSelfMute(voiceState, selfMute, talking);
};

actions.setVoiceDeafen0 = ({ voiceState }, selfDeafen) => {
    setVoiceSelfDeafen(voiceState, selfDeafen);
};

actions.setVoiceTalking0 = ({ voiceState }, talking) => {
    setVoiceTalking(voiceState, talking);
};

actions.sendMessageSFU0 = ({ voiceState }, message) => {
    info("message the sfu", message);
    sendMessageSFU(voiceState, message);
};

actions.newChannel0 = ({ userID }) => {
    if (!serverAllows(userID, PERM_EDIT_CHANNELS)) {
        throw "user lacks permission to perform this action";
    }
    createChannel();
};

actions.deleteChannel0 = ({ userID }, channelID) => {
    if (!serverAllows(userID, PERM_EDIT_CHANNELS)) {
        throw "user lacks permission to perform this action";
    }
    deleteChannel(channelID);
    clearDomainPermissions(`voiceChannel.${channelID}`);
};

actions.setPermissionInDomain0 = ({ userID }, roleID, subdomain, permission, state) => {
    if (!serverAllows(userID, PERM_EDIT_ROLES)) {
        throw "user lacks permission to perform this action";
    }
    setDomainPermission(roleID, subdomain, permission, state);
};

actions.clearPermissionsInDomain0 = ({ userID }, subdomain) => {
    if (!serverAllows(userID, PERM_EDIT_ROLES)) {
        throw "user lacks permission to perform this action";
    }
    clearDomainPermissions(subdomain);
};

actions.joinChannel0 = ({ userID, voiceState }, channelID, selfMute, selfDeafen) => {
    if (!channelAllows(userID, PERM_JOIN_CHANNEL, channelID) && channelID !== -1) {
        throw "user lacks permission to perform this action";
    }
    if (channelID !== -1) {
        setVoiceSelfMute(voiceState, selfMute, false);
        setVoiceSelfDeafen(voiceState, selfDeafen);
    }
    joinChannel(voiceState, channelID);
};

actions.setChannelName0 = ({ userID }, channelID, name) => {
    if (!serverAllows(userID, PERM_EDIT_CHANNELS)) {
        throw "user lacks permission to perform this action";
    }
    setChannelName(channelID, name);
};

actions.newRoom0 = ({ userID }) => {
    info("new room by", userID);
    if (!serverAllows(userID, PERM_EDIT_ROOMS)) {
        throw "user lacks permission to perform this action";
    }
    createRoom();
};

actions.newMessage0 = async (session, { attachment, content, encryptedBy, roomID, informs, idempotence }) => {
    if (!roomAllows(session.userID, PERM_WRITE_CHAT, roomID)) {
        throw "user is not allowed to post in this room";
    }

    const existingMessage = session.chatMessages.get(idempotence);
    if (existingMessage !== undefined && existingMessage !== "") {
        sendAttachmentIdempotence(session, existingMessage);
        return;
    }

    const { uploadURL, messageAttachment } = await prepareAttachment(attachment);

    const { chunkID, messageIndex } = createMessage(
        session.userID,
        roomID,
        content,
        encryptedBy,
        messageAttachment,
        informs
    );

    const messageIdempotence = messageAttachment
        ? {
              chunkID,
              messageIndex,
              idempotence,
              roomID,
              uploadURL,
          }
        : "";
    session.chatMessages.set(idempotence, messageIdempotence);
    sendAttachmentIdempotence(session, messageIdempotence);

    // TODO: Maybe some kind of DOS-attack protection?
    // TODO: Adher to some kind of spec instead of just sending content.
    sendNotification(informs, content);
};

actions.unveilAttachment0 = async ({ userID }, { roomID, chunkID, messageIndex }) => {
    await unveilMessageAttachment(userID, roomID, chunkID, messageIndex);
};

actions.deleteMessage0 = ({ userID }, roomID, chunkID, messageIndex) => {
    if (roomAllows(userID, PERM_CLEAN_CHAT, roomID)) {
        deleteAnyMessage(roomID, chunkID, messageIndex);
    } else if (roomAllows(userID, PERM_RETRACT_CHAT, roomID)) {
        deleteOwnMessage(roomID, chunkID, messageIndex, userID);
    } else {
        throw "you are not allowed to retract messages here";
    }
};

actions.editMessage0 = ({ userID }, roomID, chunkID, messageIndex, content) => {
    // TODO: Maybe this action should be renamed to "set-"something

    if (!roomAllows(userID, PERM_EDIT_CHAT, roomID)) {
        throw "user is not allowed to edit messages in this room";
    }
    editMessage(roomID, chunkID, messageIndex, content, userID);
};

actions.deleteRoom0 = ({ userID }, roomID) => {
    if (!serverAllows(userID, PERM_EDIT_ROOMS)) {
        throw "user lacks permission to perform this action";
    }
    deleteRoom(roomID);
    clearDomainPermissions(`textRoom.${roomID}`);
};

actions.setRoomName0 = ({ userID }, roomID, name) => {
    if (!serverAllows(userID, PERM_RENAME_ROOM)) {
        throw "user is not allowed to rename this room";
    }
    setRoomName(roomID, name);
};

actions.setRoomEncryptedBy0 = ({ userID }, roomID, encryptedBy) => {
    if (!serverAllows(userID, PERM_EDIT_ROOMS)) {
        throw "user is not allowed to set encryption fingerprint on this room";
    }
    setRoomEncryptedBy(roomID, encryptedBy);
};

actions.setRoomDescription0 = ({ userID }, roomID, description) => {
    if (!serverAllows(userID, PERM_RENAME_ROOM)) {
        throw "user is not allowed change the description for this room";
    }
    setRoomDescription(roomID, description);
};

actions.newServerRole0 = ({ userID }) => {
    if (!serverAllows(userID, PERM_EDIT_ROLES)) {
        throw "user lacks permission to perform this action";
    }
    createRole();
};

actions.giveServerRole0 = (session, userID, roleID) => {
    if (!serverAllows(session.userID, PERM_EDIT_ROLES)) {
        throw "user lacks permission to perform this action";
    }
    giveServerRole(userID, roleID);
};

actions.revokeServerRole0 = (session, userID, roleID) => {
    if (!serverAllows(session.userID, PERM_EDIT_ROLES)) {
        throw "user lacks permission to perform this action";
    }
    revokeServerRole(userID, roleID);
};

actions.deleteServerRole0 = ({ userID }, roleID) => {
    if (!serverAllows(userID, PERM_EDIT_ROLES)) {
        throw "user lacks permission to perform this action";
    }
    deleteRole(roleID);
};

actions.setRoleName0 = ({ userID }, roleID, name) => {
    if (!serverAllows(userID, PERM_EDIT_ROLES)) {
        throw "user lacks permission to perform this action";
    }
    setServerRoleName(roleID, name);
};

actions.swapRolePenalty0 = ({ userID }, penaltyA, penaltyB) => {
    if (!serverAllows(userID, PERM_EDIT_ROLES)) {
        throw "user lacks permission to perform this action";
    }
    swapRolePenalty(penaltyA, penaltyB);
};

actions.setServerName0 = ({ userID }, name) => {
    if (!serverAllows(userID, PERM_EDIT_SERVER_INFO)) {
        throw "user lacks permission to perform this action";
    }
    setServerName(name);
};

actions.requestProfileUpload0 = async (session, profileTimestamp) => {
    const url = await getProfileUpload(session.userID, profileTimestamp);
    sendProfileUploadURL(session, url, profileTimestamp);
};

actions.setProfile0 = ({ userID }, profileTimestamp) => {
    userChangesProfile(userID, profileTimestamp);
};
actions.acknowledgeUpdates0 = (session, sessionNumber, versions, forceSync) => {
    // TODO: More like acknowledgeUpdate0?
    if (session.sessionNumber !== sessionNumber) {
        return;
    }
    info(versions);
    session.parsedVersions = parseReceivedVersions(versions);
    session.pendingUpdates.length = 0;
    session.updatesAcknowledged = true;
    if (forceSync) {
        scheduleSync();
    }
};
actions.pong0 = function () {};

/**
 * @param {VersionIdentifier} path
 * @param {UpdateObject[]} results
 */
function objectRouter(path, results) {
    if (path.typeAndPath === "rooms") {
        roomUpdates(results);
    } else if (path.typeAndPath.startsWith("chunk.")) {
        const roomID = nthVersionSegment(path, 0);
        const chunkID = nthVersionSegment(path, 1);
        chunkUpdates(roomID, chunkID, results);
    } else if (path.typeAndPath === "serverInfo") {
        serverInfoUpdate(results);
    } else if (path.typeAndPath === "roles") {
        roleUpdates(results);
    } else if (path.typeAndPath === "permissions") {
        permissionUpdates(results);
    } else if (path.typeAndPath === "channels") {
        channelUpdates(results);
    } else if (path.typeAndPath === "activeChannels") {
        activeChannelUpdates(results);
    } else if (path.typeAndPath === "users") {
        userUpdates(results);
    } else {
        error("unknown object type:", path.typeAndPath);
    }
}

/**
 * @param {VersionIdentifier} _id
 * @param {Session} _s
 * @param {UpdateObjectVariants} v
 * @returns {UpdateObjectVariants|undefined}
 */
function getUserPOV(_id, { userID }, v) {
    if (v.type === "room") {
        if (!roomAllows(userID, PERM_READ_CHAT, v.data.roomID) && !serverAllows(userID, PERM_EDIT_ROLES)) {
            return undefined;
        }
    }
    if (v.type === "message") {
        if (!roomAllows(userID, PERM_READ_CHAT, v.data.roomID)) {
            return undefined;
        }
    }
    return v;
}
/**
 * @param {Session} s
 */
function sendUpdates(s) {
    if (s.currentSSE && !s.currentSSE.closed) {
        s.currentSSE.write(
            utf8Encoder.encode(`event: update0\r\ndata: ${JSON.stringify(s.pendingUpdates)}\r\n\r\n`)
        );
        s.pendingUpdates.length = 0;
    }
}

setSyncHandler(function () {
    updateAllUsers(sessionsBySessionID, objectRouter, getUserPOV, sendUpdates);
});

const utf8Encoder = new TextEncoder();

/**
 * @param {ServerResponse} sse
 * @param {string} userID
 */
function sendProvision(sse, userID) {
    /** @type {ServerToClientProvision} */
    const provision = {
        definedPermissions,
        attachmentsURL: getBucketURL("attachments"),
        profilesURL: getBucketURL("profiles"),
        supportedActions: Object.keys(actions),
        userID: userID,
        publicSalt: getPublicSaltString(),
    };
    sse.write(utf8Encoder.encode(`event: provision0\r\ndata: ${JSON.stringify(provision)}\r\n\r\n`));
}
/**
 * @param {ServerResponse} sse
 * @param {number} n
 */
function sendSessionNumber(sse, n) {
    sse.write(utf8Encoder.encode(`event: sessionNumber0\r\ndata: ${n}\r\n\r\n`));
}

/**
 * @param {ServerResponse} sse
 */
function sendGiveNotificationToken(sse) {
    sse.write(utf8Encoder.encode(`event: giveNotificationToken0\r\ndata:\r\n\r\n`));
}

/**
 * @param {Session} session
 * @param {ServerResponse} resp
 */
function startClientSSE(session, resp) {
    session.parsedVersions = [];
    session.sessionNumber++;
    if (session.currentSSE) {
        // Close the existing SSE.
        session.currentSSE.end();
    }

    // If we are already authenticated,
    // we don't need to wait for a message.
    userGoesOnline(session.userID);

    if (session.leaveVoiceChannelTimer !== undefined) {
        // We did reconnect in time! Hurrah!
        clearTimeout(session.leaveVoiceChannelTimer);
        session.leaveVoiceChannelTimer = undefined;
    }

    let timedOut = false;

    function didNotReconnectInTime() {
        info("disconnecting peer due to timeout", session.userID);
        session.leaveVoiceChannelTimer = undefined;
        if (session.voiceState.channelID !== -1) {
            joinChannel(session.voiceState, -1);
        }
    }

    function onDisconnect() {
        info("onDisconnect called for", session.userID);
        if (session.currentSSE === resp) {
            session.currentSSE = undefined;
        }
        userGoesOffline(session.userID);

        if (timedOut) {
            info("waiting some time before fully disconnecting", session.userID);
            session.leaveVoiceChannelTimer = setTimeout(didNotReconnectInTime, config.connectionTimeout);
        } else {
            didNotReconnectInTime();
        }
    }

    function onTimeout() {
        timedOut = true;
        resp.destroy();
        console.log("reload");
    }

    resp.setTimeout(config.connectionTimeout, onTimeout);

    resp.on("close", onDisconnect);
    resp.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Keep-Alive": "timeout=9007199254740991",
        Connection: "Keep-Alive", // Oak seems to set this and the above.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "cache-control",
        "X-Accel-Buffering": "no",
    });

    session.currentSSE = resp;
    sendProvision(resp, session.userID);
    sendSessionNumber(resp, session.sessionNumber);
    sendGiveNotificationToken(resp);
}

/**
 * @param {string} deviceID
 * @returns {string}
 */
function getNonceByDeviceID(deviceID) {
    let nonce = nonceByDeviceID.get(deviceID);
    if (nonce === undefined) {
        nonce = randomNonce(config.publicURL, config.serverID);
        nonceByDeviceID.set(deviceID, nonce);
    }
    return nonce;
}

/**
 * getSessionByAuthMethod will throw if the session is unauthenticated and unable
 * to authenticate using the provided data.
 * @param {CombinedAuthMethod} authMethod
 * @param {CombinedAuthMethod} authMethod
 * @param {string} deviceID
 * @returns {Promise<Session>}
 */
async function getSessionByAuthMethod(authMethod, deviceID) {
    // TODO: maybe each session should include clientIP and force reauthentication if the IP changes to prevent token stealing?

    // The first part of this procedure is to find the real session.

    let sessionID = sessionByDeviceID.get(deviceID);
    if (sessionID === undefined) {
        // Reserve a slot.
        sessionID = sessionsBySessionID.length;
        sessionsBySessionID.push(undefined);
        sessionByDeviceID.set(deviceID, sessionID);
    }

    let session = sessionsBySessionID[sessionID];
    if (session === undefined) {
        // Create a session which expected a certain authID.
        session = new Session(sessionID, authMethod.mainIdentifier.expectedAuthID);
        sessionsBySessionID[sessionID] = session;
    }

    // Make sure that this session was actually created with this authID in mind.
    // So that people can't hijack sessions. As an extra safety precaution we later also
    // check that the userID hasn't changed. But this is the main and first-line of defence.
    if (session.expectedAuthID !== authMethod.mainIdentifier.expectedAuthID) {
        throw "different authIDs were provided for the same deviceID";
    }

    if (session.failedLoginAttempts >= 12) {
        session.blocked = true;
        throw "session has been blocked";
    }

    // This is the part two of this procedure where the actual verification takes place.

    const nonce = getNonceByDeviceID(deviceID);

    /** @type {string} */
    let errorText;

    try {
        const userID = await loginWithTransfers(
            authMethod.mainIdentifier,
            authMethod.transferIdentifiers,
            session.expectedAuthID,
            nonce
        );

        if (userID === INVALID_SESSION) {
            throw "authentication resulted in an invalid userID";
        } else if (session.userID === INVALID_SESSION) {
            // The session becomes valid as of this line.
            session.userID = userID;
            session.voiceState.userID = session.userID;

            return session;
        } else if (session.userID === userID) {
            // Authenticated to the expected userID.
            return session;
        }

        // If this happens that something very weird has happened.
        // authIDs shouldn't just randomly change what userID they resolve to...
        // However we keep this as an extra saftey precaution.
        throw "authentication resulted in another userID";
    } catch (e) {
        errorText = typeof e === "string" ? e : "server error";
        if (typeof e !== "string") {
            console.error(e);
        }
    }

    // Anything past the catch should be considered an error.

    session.failedLoginAttempts++;

    throw new MissingAuth({
        attemptType: "main",
        attempt: authMethod.mainIdentifier,
        error: errorText,
        nonce,
        publicSalt: getPublicSaltString(),
    });
}

/**
 * @param {URL} url
 * @param {ActionRequest} [actionRequest]
 * @returns {Promise<Session>|Session}
 */
function getSessionFromRequest(url, actionRequest) {
    // The general idea of this function is that the following input will give the user the following output:
    // deviceID => nonce + publicSalt
    // deviceID + authMethod + expectedAuthID => actionSideEffect + sessionID + sessionToken
    // sessionID + sessionToken => actionSifeEffect
    // The userID will be obtained over SSE. Although perhaps another method should be provided.

    const sessionID = url.searchParams.get("id") || "0";

    const sessionToken = url.searchParams.get("token") || INVALID_SESSION;

    const deviceID = url.searchParams.get("device");
    if (!deviceID) {
        throw "insecure choice of deviceID";
    }

    // If this were C or Zig we'd do a bounds check here as well.
    let sessionIndex = parseInt(sessionID);

    // TODO: --- maybe each session should include clientIP and force reauthentication if the IP changes to prevent token stealing?
    let session = sessionsBySessionID[sessionIndex];
    if (
        session !== undefined &&
        session.sessionToken === sessionToken &&
        sessionToken !== INVALID_SESSION &&
        session.userID !== INVALID_SESSION
    ) {
        // The token is like our temporary password here. It matches so continue.
        // We hand the token out to anyone that can authenticate using normal methods.
        // But only if they authenticated into either an unused session or their
        // authentication resulted in the same userID and authID.
        return session;
    } else if (actionRequest && actionRequest.auth) {
        // Do some validation before entering the async function while we still have the URL.
        // We could move this out of the if, but it is kinda nice that the appVersion is ignored
        // if you are already successfully signed in.
        const appVersion = url.searchParams.get("appVersion");
        const isDeveloper = url.searchParams.has("isDeveloper");

        if (typeof appVersion !== "string") {
            throw "provide appVersion or set isDeveloper = true";
        }
        if (!acceptableVersion(appVersion) && !isDeveloper) {
            throw "unsupported client version";
        }

        // This is the step where the token can actually be given if the client doesn't have it.
        // Granted that it is capable of authenticating itself properly through an auth-method.
        return getSessionByAuthMethod(actionRequest.auth, deviceID);
    }

    throw new MissingAuth({
        attemptType: "main",
        error: "no auth method provided",
        nonce: getNonceByDeviceID(deviceID),
        publicSalt: getPublicSaltString(),
    });
}

/**
 * @param {IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
    /** @type {string[]} */
    const chunks = [];
    return new Promise((ok, err) => {
        req.on("data", function (chunk) {
            chunks.push(chunk);
        });
        req.on("end", function () {
            ok(chunks.join(""));
        });
        req.on("error", function (e) {
            err(e);
        });
    });
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} resp
 * @returns {Promise<void>}
 */
async function requestHandler(req, resp) {
    const url = new URL(req.url || "", "http://localhost");

    const parts = url.pathname.split(/[\/\\\.]/, 64);
    info(parts);

    if (parts[1] === "action") {
        const msg = JSON.parse(await readBody(req));
        const msgReq = actionRequest.parse(msg);

        const authorized = await getSessionFromRequest(url, msgReq);

        const name = /** @type {ActionsKey} */ (parts[2]);
        if (typeof name !== "string") {
            throw "name must be a string";
        }
        if (!(name in actions)) {
            throw "name is not a supported action";
        }
        const actionData = actionsData[name];
        const data = actionData.parse(msgReq.args);
        const handler = /** @type {(...any: any[]) => Promise<void>} */ (actions[name]);
        await handler(authorized, ...data);

        resp.setHeader("Access-Control-Allow-Origin", "*");
        resp.end(JSON.stringify({ id: `${authorized.sessionID}`, token: authorized.sessionToken }));
    } else if (parts[1] === "updates") {
        startClientSSE(await getSessionFromRequest(url), resp);
    } else if (parts[1] === "ice") {
        // TODO: Is this even used?

        resp.writeHead(200, { "Access-Control-Allow-Origin": "*" });
        resp.write(JSON.stringify(config.iceServers));
        resp.end();
    } else if (parts[1] === "") {
        const params = new URLSearchParams({
            autoJoinURL: config.publicURL,
        });
        const goodWebClientURL = `https://cdn.taigachat.se/versions/dist/?${params}`;
        resp.writeHead(301, goodWebClientURL, {
            Location: goodWebClientURL,
        });
        resp.end();
    } else {
        resp.writeHead(404, "unsupported endpoint");
        resp.end();
    }
}

/**
 * @param {WebSocket} ws
 * @param {IncomingMessage} req
 */
function commonWebSocketResponder(ws, req) {
    const url = new URL(req.url || "", "http://localhost");
    const parts = url.pathname.split(/[\/\\\.]/, 64);

    if (parts[1] !== "media-worker") {
        error("upgrade attempt on invalid url:", req.url);
        try {
            ws.close();
        } catch (_) {}
        return;
    }

    mediaWorkerWebSocketConnected(ws, parseInt(parts[2] || ""), parts[3] || "");
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} resp
 */
async function commonRequestResponder(req, resp) {
    if (req.method === "OPTIONS") {
        resp.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "cache-control, user-agent",
        });
        resp.end();
        return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
        resp.writeHead(405, { "Access-Control-Allow-Origin": "*", Allow: "OPTIONS, GET, POST" });
        resp.end();
        return;
    }

    try {
        await requestHandler(req, resp);
    } catch (e) {
        if (typeof e === "string") {
            // A string means that we wish to show
            resp.writeHead(400, { "Access-Control-Allow-Origin": "*" });
            resp.write(e);
            resp.end();
        } else if (e instanceof MissingAuth) {
            // We get here if an authentication fails.
            // We then provide a nonce so that the client can try again
            // with that nonce in mind.
            const asJson = JSON.stringify(e.authFailure);

            resp.writeHead(401, { "Access-Control-Allow-Origin": "*" });
            resp.write(asJson);
            resp.end();
        } else {
            error(e);
            resp.writeHead(401, { "Access-Control-Allow-Origin": "*" });
            resp.write("internal server error");
            resp.end();
        }
    }
}

let _unixServer = undefined;
let _wssUnixServer = undefined;

/**
 * @param {string} path
 */
async function startHttpUnix(path) {
    try {
        unlinkSync(path);
    } catch (_e) {
        // Ignored.
    }
    const server = createServer(commonRequestResponder);

    const wss = new WebSocketServer({ server });
    wss.on("connection", commonWebSocketResponder);

    //server.on('upgrade', commonRequestUpgradeResponder)
    server.listen(path);

    // We could also set a umask, but then other files would be affected by that.
    chmodSync(path, "660");

    _wssUnixServer = wss;
    _unixServer = server;
}

let _httpServer = undefined;
let _wssHttpServer = undefined;
/**
 * @param {number} port
 */
function startHttp(port) {
    const server = createServer(commonRequestResponder);

    const wss = new WebSocketServer({ server });
    wss.on("connection", commonWebSocketResponder);

    server.listen(port);

    _wssHttpServer = wss;
    _httpServer = server;
}
/**
 * @param {number} _port
 */
async function startHttps2(_port) {
    throw new Error("HTTPS disabled for now");
    // TODO: We might need to watch both symlinkResolvedCert and the original symlink.
    //const symlinkResolvedCert = await Deno.realPath(config.certFile)
    //info('real cert file location:', symlinkResolvedCert)
    //const certWatcher = Deno.watchFs(symlinkResolvedCert, {recursive: false})
    //const certWatcherIter = certWatcher[Symbol.asyncIterator]()
    //while(true) {
    //    const connectionIter = Deno.listenTls({
    //        port,
    //        reusePort: true,
    //        certFile: config.certFile,
    //        keyFile: config.keyFile,
    //        alpnProtocols: ["h2", "http/1.1"],
    //    })
    //    while(true) {
    //        const promiseResult = await Promise.any([certWatcherIter.next(),
    //                                                 connectionIter.accept()])
    //        if ('localAddr' in promiseResult) {
    //            info('new connection')
    //            commonConnectionLoop(promiseResult)
    //        } else {
    //            connectionIter.close()

    //            // Give the scheduler time to close the port.
    //            await new Promise(ok => setTimeout(ok, 10))
    //            info('reload cert')
    //            break
    //        }

    //    }
    //}
}

// TODO: Respond with HTTP code 204 instead of 200 where it is appropriate!

async function main() {
    if (process.env["TAIGACHAT_RUN_SELF_TEST"] == "1") {
        // TODO: either move to Deno tests / bun tests, remove or make part of the config
        rolesUnitTest();
        //authUnitTest();
        return;
    }

    // Sleep one milisecond such that we never get the same Date.now()
    // as the previous run of this server.
    await new Promise(function (ok) {
        setTimeout(ok, 1);
    });

    info("starting server:", config.serverID);

    runMigrations();
    ensureDefaultRoles();

    startS3();
    createBuckets();

    setClientMessageCallback(function (channelID, peer, msg) {
        const session = sessionsBySessionID[peer];
        if (
            session === undefined ||
            session.voiceState.channelID !== channelID ||
            session.currentSSE === undefined
        ) {
            return;
        }
        session.currentSSE.write(
            utf8Encoder.encode(`event: sfuMessage0\r\ndata: ${JSON.stringify(msg)}\r\n\r\n`)
        );
    });

    let listening = false;

    if (typeof config.unixSocket === "string") {
        listening = true;
        startHttpUnix(config.unixSocket);
    }

    if (typeof config.httpPort === "number") {
        listening = true;
        startHttp(config.httpPort);
    }

    if (typeof config.httpsPort === "number") {
        listening = true;
        startHttps2(config.httpsPort);
    }

    let pingerOffset = 0;
    setInterval(
        function () {
            pingerOffset = (pingerOffset + 1) % config.pingIntervalSplit;
            // We don't send more than 40 000 pings. There current implementation is a bit unfair tho.
            for (let i = 0; i < Math.min(sessionsBySessionID.length, 40000); i++) {
                // Each time it function triggers, we only ping a slice of all users.
                if (i % config.pingIntervalSplit !== pingerOffset) {
                    continue;
                }
                const session = sessionsBySessionID[i];
                if (session === undefined || session.currentSSE === undefined) {
                    continue;
                }
                session.currentSSE.write(utf8Encoder.encode(`event: ping0\r\ndata:\r\n\r\n`));
                //console.log('ping', session.userID)
            }
        },
        Math.max(config.connectionTimeout * 0.45, 1) / config.pingIntervalSplit
    );

    if (!listening) {
        error("please specify a port or unix socket to listen to");
    }
}

main();
