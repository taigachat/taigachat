import { spawn, ChildProcess } from "node:child_process";

import { lastModifiedPosition, scheduleSync } from "./last_modified.js";

/**
 * @import { Statement } from 'better-sqlite3'
 */

import { db } from "./db.js";

/**
 * @import { VoiceState, MessageToSFU, MessageFromSFU, UpdateObjectVariants } from './schema.ts'
 */

import { sfuToServer } from "./schema.ts";

import { randomString } from "./auth.js";

import config from "./config.js";

import { getLog } from "./log.ts";

import { setLastModifiedToLatest } from "./updater.js";

const { info, error } = getLog("channels");

/**
 * @import WebSocket from './vendor/ws/websocket.js'
 */

// TODO: Maybe we can move activeChannel to its own file someday?

/**
 * @typedef {{
 *  workerIndex: number,
 *  channelID: number,
 *  connectedUsers: VoiceState[]
 *  lastModified: number,
 *  faddishness: number,
 * }} ActiveChannel
 */

/** @type {Map<number, ActiveChannel>} */
export const activeChannels = new Map();

/** @type {(_1: number, _2: number, _3: MessageFromSFU) => void} */
let clientMessageCallback = (_1, _2, _3) => {
    throw new Error("clientMessageCallback() called before setClientMessageCallback(cb)");
};

/**
 * @param {(channel_id: number, peer_id: number, message: MessageFromSFU) => void} cb
 */
export function setClientMessageCallback(cb) {
    clientMessageCallback = cb;
}

const decoder = new TextDecoder();

/**
 * @typedef {{
 *  code: string,
 *  state: 'connected' | 'connecting' | 'disconnected',
 *  process?: ChildProcess,
 *  ws?: WebSocket,
 *  index: number,
 *  queue: string[],
 * }} GenericMediaWorker
 */

/**
 * @param {GenericMediaWorker} worker
 * @param {string} asJSON
 */
function sendMediaMessageToWorker(worker, asJSON) {
    if (worker.ws) {
        worker.ws.send(asJSON);
    } else {
        throw new Error("no valid means to contact worker");
    }
}

/**
 * @param {GenericMediaWorker} worker
 */
function flushMediaWorkerQueue(worker) {
    for (const message of worker.queue) {
        sendMediaMessageToWorker(worker, message);
    }
    worker.queue.length = 0;
}

/**
 * @param {GenericMediaWorker} worker
 */
function resetWorker(worker) {
    worker.queue = [];

    worker.state = "disconnected";

    worker.code = randomString();

    if (worker.process) {
        try {
            worker.process.kill("SIGKILL");
        } catch (_) {}
    }
    worker.process = undefined;

    if (worker.ws) {
        try {
            worker.ws.close();
        } catch (_) {}
    }
    worker.ws = undefined;
}

/** @type {Array<GenericMediaWorker>} */
const mediaWorkers = new Array();
for (let i = 0; i < config.mediaWorker.workerCount; i++) {
    /** @type {GenericMediaWorker} */
    const worker = {
        code: randomString(),
        state: "disconnected",
        process: undefined,
        ws: undefined,
        index: i,
        queue: [],
    };

    // Just to be sure.
    resetWorker(worker);
    mediaWorkers.push(worker);
}

/**
 * @param {WebSocket} ws
 * @param {number} index
 * @param {string} code
 */
export function mediaWorkerWebSocketConnected(ws, index, code) {
    const worker = mediaWorkers[index];
    if (worker === undefined || worker.code !== code || worker.state !== "connecting") {
        error("failed sfu ws authentication");
        return;
    }

    worker.ws = ws;
    worker.state = "connected";
    flushMediaWorkerQueue(worker);
    ws.on("error", function (e) {
        error("websocket for worker", index, "had the following error:", e);
    });
    ws.on("message", function (event) {
        if (event.data === "heartbeat") {
            info("heartbeat received");
            return;
        }
        const msg = sfuToServer.parse(JSON.parse(decoder.decode(event)));
        info("websocket:", msg);
        clientMessageCallback(msg[0], msg[1], msg[2]);
    });
    ws.on("close", function () {
        error("mediaWorker lost connection unexpectedly");
        resetWorker(worker);
    });
}

/**
 * @param {number} id
 * @param {string} code
 */
function controllerURL(id, code) {
    if (config.unixSocket) {
        return `ws://unix/media-worker/${id}/${code}:${config.unixSocket}`;
    }
    if (config.httpPort) {
        return `ws://localhost:${config.httpPort}/media-worker/${id}/${code}`;
    }
    throw "config error, http must be configured for the SFU";
}

let msWorkerIndex = 0;

/**
 * @returns {GenericMediaWorker}
 */
function getMediaWorker() {
    const mediaWorker = /** @type {GenericMediaWorker} */ (
        mediaWorkers[msWorkerIndex++ % mediaWorkers.length]
    );

    if (mediaWorker.state === "disconnected") {
        // Just to be sure. And to generate a new code.
        resetWorker(mediaWorker);

        //info('media-worker', index, 'path', config.mediaWorker.path, code)

        const announceIP = config.mediaWorker.announceIP;

        // TODO: validate ipv4/ipv6.
        if (announceIP === "" || announceIP === "0.0.0.0" || announceIP === "127.0.0.1") {
            throw "server has configured a bad announce IP for the SFU";
        }

        mediaWorker.state = "connecting";

        const cmd = spawn(config.mediaWorker.path, {
            env: {
                // TODO: We do not currently send mediasoup.worker.codecs? Do we still want to have it as a configurable variable?
                SFU_WORKER_ID: `${mediaWorker.index}`,
                SFU_WORKER_CODE: mediaWorker.code,
                SFU_CONTROLLER_URL: controllerURL(mediaWorker.index, mediaWorker.code),
                SFU_RTC_MIN_PORT: `${config.mediaWorker.worker.rtcMinPort}`,
                SFU_RTC_MAX_PORT: `${config.mediaWorker.worker.rtcMaxPort}`,
                SFU_LOG_LEVEL: config.mediaWorker.worker.logLevel,
                SFU_LOG_TAGS: config.mediaWorker.worker.logTags.join(";"),
                SFU_LISTEN_IP: "0.0.0.0", // TODO: make configurable
                SFU_ANNOUNCE_IP: announceIP,
            },
            stdio: "inherit",
        });

        mediaWorker.process = cmd;

        cmd.on("error", function (e) {
            error("could not launch media worker:", e);
            resetWorker(mediaWorker);
        });
        cmd.on("exit", function (_) {
            error("media worker at index", mediaWorker.index, "exited unexpectedly");
            resetWorker(mediaWorker);
        });
    }

    return mediaWorker;
}

/**
 * @param {number} workerIndex
 * @param {any} message
 */
function sendMediaMessage(workerIndex, message) {
    // TODO: Use schema
    const worker = mediaWorkers[workerIndex];
    if (worker === undefined) {
        return;
    }
    const asJSON = `${JSON.stringify(message)}\n`;
    if (worker.state === "connecting") {
        worker.queue.push(asJSON);
    } else if (worker.state === "connected") {
        sendMediaMessageToWorker(worker, asJSON);
    } else {
        info("attempted to send message to a dead worker");
    }
}

/**
 * @param {number} channelID
 * @returns {ActiveChannel}
 */
function getActiveChannel(channelID) {
    const current = activeChannels.get(channelID);
    if (current !== undefined) {
        return current;
    }
    const worker = getMediaWorker();

    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {ActiveChannel} */
    const channel = {
        workerIndex: worker.index,
        channelID,
        connectedUsers: [],
        lastModified,
        faddishness,
    };
    activeChannels.set(channelID, channel);
    scheduleSync();

    sendMediaMessage(worker.index, {
        type: "NewChannel",
        codecs: config.mediaWorker.router.mediaCodecs,
        channel: channelID,
    });

    return channel;
}

/**
 * @param {VoiceState} voiceState
 * @param {MessageToSFU} message
 * @returns {Promise<void>|void}
 */
export function sendMessageSFU(voiceState, message) {
    const activeChannel = activeChannels.get(voiceState.channelID);
    if (activeChannel !== undefined) {
        return sendMediaMessage(activeChannel.workerIndex, {
            type: "HandleClient",
            channel: activeChannel.channelID,
            peer: voiceState.peerID,
            message,
        });
    }
}

/**
 * Synchronizes VoiceState with both clients and media workers.
 * @param {VoiceState} voiceState
 * @param {boolean} rtcDeafen
 */
function synchronizeVoiceState(voiceState, rtcDeafen) {
    const activeChannel = activeChannels.get(voiceState.channelID);
    if (activeChannel === undefined) {
        return;
    }

    if (rtcDeafen) {
        sendMediaMessage(activeChannel.workerIndex, {
            type: "SetDeafenPeer",
            channel: activeChannel.channelID,
            peer: voiceState.peerID,
            deafen: voiceState.selfDeafen,
        });
    }

    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);
    activeChannel.lastModified = lastModified;
    activeChannel.faddishness = faddishness;

    scheduleSync();
}

/**
 * @param {VoiceState} voiceState
 * @param {number} channelID
 */
function moveChannel(voiceState, channelID) {
    const oldActiveChannel = activeChannels.get(voiceState.channelID);
    if (oldActiveChannel !== undefined) {
        info(voiceState.userID, "disconnect from:", oldActiveChannel.channelID);
        oldActiveChannel.connectedUsers = oldActiveChannel.connectedUsers.filter((v) => v != voiceState);

        sendMediaMessage(oldActiveChannel.workerIndex, {
            type: "RemovePeer",
            channel: oldActiveChannel.channelID,
            peer: voiceState.peerID,
        });

        const lastModified = Date.now();
        const faddishness = lastModifiedPosition(lastModified);
        oldActiveChannel.lastModified = lastModified;
        oldActiveChannel.faddishness = faddishness;

        scheduleSync();
    }
    info(voiceState.userID, "move to channel", channelID);
    voiceState.channelID = channelID;
    if (channelID !== -1) {
        /** @type {Statement<[number], {}>} */
        const stmt = db.prepare("SELECT 1 FROM channels WHERE channel_id = ?");
        if (stmt.get(channelID) === undefined) {
            throw "invalid channel";
        }

        const activeChannel = getActiveChannel(channelID);
        activeChannel.connectedUsers.push(voiceState);

        sendMediaMessage(activeChannel.workerIndex, {
            type: "AddPeer",
            channel: channelID,
            peer: voiceState.peerID,
        });

        const lastModified = Date.now();
        const faddishness = lastModifiedPosition(lastModified);
        activeChannel.lastModified = lastModified;
        activeChannel.faddishness = faddishness;

        scheduleSync();
    }
    synchronizeVoiceState(voiceState, true);
}

/**
 * @param {VoiceState} voiceState
 * @param {number} channelID
 */
export function joinChannel(voiceState, channelID) {
    if (channelID === voiceState.channelID) {
        throw "server should not allow rejoining the same channel";
    }
    moveChannel(voiceState, channelID);
}

/**
 * @param {VoiceState} state
 * @param {boolean} talking
 */
export function setVoiceTalking(state, talking) {
    state.talking = talking;
    if (state.selfMute) {
        return;
    }
    synchronizeVoiceState(state, false);
}

/**
 * @param {VoiceState} state
 * @param {boolean} mute
 * @param {boolean} talking
 */
export function setVoiceSelfMute(state, mute, talking) {
    state.selfMute = mute;
    state.talking = !mute && talking;
    synchronizeVoiceState(state, false);
}

/**
 * @param {VoiceState} state
 * @param {boolean} deafen
 */
export function setVoiceSelfDeafen(state, deafen) {
    state.selfDeafen = deafen;
    synchronizeVoiceState(state, true);
}

export function createChannel() {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[number, number], {}>} */
    const stmt = db.prepare("INSERT INTO channels (last_modified, faddishness) VALUES (?, ?)");
    stmt.run(lastModified, faddishness);
    scheduleSync();
}

/**
 * @param {number} channelID
 */
export function deleteChannel(channelID) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[number], {}>} */
    const stmt = db.prepare("DELETE FROM channels WHERE channel_id = ?");
    stmt.run(channelID);

    /** @type {Statement<[number, number], {}>} */
    const updateStmt = db.prepare(
        "UPDATE channels SET last_modified = ?, faddishness = ? WHERE channel_id = (SELECT MIN(channel_id) FROM channels LIMIT 1) "
    );
    updateStmt.run(lastModified, faddishness);

    scheduleSync();

    const activeChannel = activeChannels.get(channelID);
    if (activeChannel !== undefined) {
        for (const user of activeChannel.connectedUsers) {
            moveChannel(user, -1);
        }
        activeChannels.delete(channelID);
    }
}

/**
 * @param {number} channelID
 * @param {string} name
 */
export function setChannelName(channelID, name) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[number, number, string, number], {}>} */
    const stmt = db.prepare(
        "UPDATE channels SET last_modified = ?, faddishness = ?, title = ? WHERE channel_id = ?"
    );
    stmt.run(lastModified, faddishness, name, channelID);

    scheduleSync();
}

/**
 * @param {UpdateObjectVariants[]} results
 */
export function channelUpdates(results) {
    /** @type {Statement<[], {last_modified: number, faddishness: number, title: string, channel_id: number}>} */
    const stmt = db.prepare("SELECT channel_id, last_modified, faddishness, title FROM channels");

    const rows = stmt.all();

    for (const row of rows) {
        results.push({
            type: "channel",
            lastModified: row.last_modified,
            faddishness: row.faddishness,
            data: {
                channelID: row.channel_id,
                name: row.title,
            },
        });
    }
    setLastModifiedToLatest(results, "channel");
}

/**
 * @param {UpdateObjectVariants[]} results
 */
export function activeChannelUpdates(results) {
    for (const [key, activeChannel] of activeChannels.entries()) {
        results.push({
            type: "activeChannel",
            lastModified: activeChannel.lastModified,
            faddishness: activeChannel.faddishness,
            data: {
                channelID: key,
                connectedUsers: activeChannel.connectedUsers,
            },
        });
    }
}
