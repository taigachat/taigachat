/** @import {UpdateObject, UpdateObjectVariants} from './schema.ts' */

import { fromRadix64 } from "./schema.ts";
import { isOlder } from "./last_modified.js";
import { getLog } from "./log.ts";

const { error } = getLog("updater");

/**
 * A version string looks something like this:
 * a.b.type.c.d
 * Where:
 * - a is the last modified
 * - b is the faddishness (usually 0)
 * - type defines what function handles the lookup
 * - c optional path for the lookup
 * - d optional path for the lookup
 * Any number of optional paths may follow by delimiting using a dot.
 * Multiple version strings are delimited using '~' and together they become a ReceivedVersions
 * @typedef {{
 *  from: string,
 *  typeAndPath: string,
 *  typeEnd: number,
 *  lastModified: number,
 *  faddishness: number,
 * }} VersionIdentifier
 */

/**
 * @param {VersionIdentifier} v
 * @param {number} n
 * @returns {number}
 */
export function nthVersionSegment(v, n) {
    let i = v.typeEnd + 1;
    while (n > 0) {
        i = v.from.indexOf(".", i);
        if (i === -1) {
            return -1;
        }
        i++;
        n--;
    }

    return fromRadix64(v.from, i);
}

/**
 * @param {string} s
 * @param {number} startAt
 * @returns {VersionIdentifier|false}
 */
function parseReceivedVersion(s, startAt) {
    const lastModifiedEnd = s.indexOf(".", startAt);
    if (lastModifiedEnd === -1) {
        return false;
    }
    const lastModified = fromRadix64(s, startAt);

    const faddishnessEnd = s.indexOf(".", lastModifiedEnd + 1);
    if (faddishnessEnd === -1) {
        return false;
    }
    const faddishness = fromRadix64(s, lastModifiedEnd + 1);

    let typeEnd = s.indexOf(".", faddishnessEnd + 1);
    if (typeEnd === -1) {
        typeEnd = s.indexOf("~", faddishnessEnd + 1);
        if (typeEnd === -1) {
            typeEnd = s.length;
        }
    }

    let end = s.indexOf("~", faddishnessEnd + 1);
    if (end === -1) {
        end = s.length;
    }

    const typeAndPath = s.substring(faddishnessEnd + 1, end);

    return {
        from: s,
        lastModified,
        faddishness,
        typeAndPath,
        typeEnd,
    };
}

/**
 * @param {string} s
 */
export function parseReceivedVersions(s) {
    /** @type {VersionIdentifier[]} */
    const versions = [];
    let i = 0;
    for (;;) {
        const version = parseReceivedVersion(s, i);
        if (version === false) {
            break;
        }
        versions.push(version);
        i = s.indexOf("~", i);
        if (i === -1) {
            break;
        }
        i++;
    }
    return versions;
}

// TODO: Calls to updateAllUsers should be scheduled through onNextTick()

/**
 * @typedef {{
 *  pendingUpdates: UpdateObjectVariants[]
 *  parsedVersions: VersionIdentifier[]
 *  updatesAcknowledged: boolean
 * }} InformedUser
 */

/**
 * @template {InformedUser} S
 * @param {(S|undefined)[]} sessions
 * @param {(vid: VersionIdentifier, result: UpdateObject[]) => void} objectRouter
 * @param {(vid: VersionIdentifier, session: S, update: UpdateObjectVariants) => UpdateObjectVariants|undefined} getUserPOV
 * @param {(session: S) => void} sendUpdates
 */
export function updateAllUsers(sessions, objectRouter, getUserPOV, sendUpdates) {
    /** @type {Map<string, VersionIdentifier>} */
    const mostOutOfDate = new Map();

    // Find the most out-of-date versions for all objects among all users.
    for (const session of sessions) {
        if (session === undefined) {
            continue;
        }
        if (!session.updatesAcknowledged) {
            // Has not acknowledged yet. Do not include in this update cycle.
            continue;
        }
        for (const version of session.parsedVersions) {
            const currentMostOutOfDate = mostOutOfDate.get(version.typeAndPath);
            if (currentMostOutOfDate === undefined || isOlder(version, currentMostOutOfDate)) {
                mostOutOfDate.set(version.typeAndPath, version);
            }
        }
    }

    /** @type {Map<string, UpdateObjectVariants[]>} */
    const possibleUpdates = new Map();

    // Collect all updates of an object newer than the oldest version from the earlier step.
    for (const version of mostOutOfDate.values()) {
        /** @type {UpdateObject[]} */
        const updates = [];
        objectRouter(version, updates);

        // In place filter.
        let j = 0;
        for (let i = 0; i < updates.length; i++) {
            const update = /** @type {!UpdateObject} */ (updates[i]);
            if (isOlder(version, update)) {
                updates[j++] = update;
            }
        }
        updates.length = j;

        possibleUpdates.set(version.typeAndPath, updates);
    }

    // Filter and schedule updates for all users that have acknowledged their updates.
    for (const session of sessions.values()) {
        if (!session.updatesAcknowledged) {
            // Has not acknowledged yet. Do not include in this update cycle.
            continue;
        }

        for (const version of session.parsedVersions) {
            const updates = possibleUpdates.get(version.typeAndPath);
            if (updates === undefined) {
                continue;
            }
            for (const update of updates) {
                if (isOlder(update, version)) {
                    // User is not interested.
                    continue;
                }
                const refinedUpdate = getUserPOV(version, session, update);
                if (refinedUpdate !== undefined) {
                    session.pendingUpdates.push(refinedUpdate);
                }
            }
        }
    }

    for (const session of sessions.values()) {
        if (!session.updatesAcknowledged || session.pendingUpdates.length === 0) {
            continue;
        }
        session.updatesAcknowledged = false;
        try {
            sendUpdates(session);
        } catch (e) {
            error("while sending update:", e);
        }
    }
}

/**
 * Makes all updates that have the same type to also have
 * the same lastModified and faddishness (by selecting the latest one found).
 * It searches from the end of updates and stops once reaching something with the incorrect type.
 * @param {UpdateObjectVariants[]} updates
 * @param {string} type
 */
export function setLastModifiedToLatest(updates, type) {
    let i = updates.length - 1;
    let latestModified = 0;
    let faddishness = 0;
    while (i >= 0) {
        const update = /** @type {UpdateObjectVariants} */ (updates[i]);
        if (update.type != type) {
            break;
        }
        if (
            update.lastModified > latestModified ||
            (update.lastModified > latestModified && update.faddishness > faddishness)
        ) {
            latestModified = update.lastModified;
            faddishness = update.faddishness;
        }
        i--;
    }
    i++;
    while (i >= 0 && i < updates.length) {
        const update = /** @type {UpdateObjectVariants} */ (updates[i]);
        update.lastModified = latestModified;
        update.faddishness = faddishness;
        i++;
    }
}
