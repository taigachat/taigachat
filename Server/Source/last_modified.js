let lastModified = 0;
let faddishness = 0;

/**
 * @param {number} ms
 * @returns {number}
 */
export function lastModifiedPosition(ms) {
    if (ms > lastModified) {
        lastModified = ms;
        faddishness = 0;
    }
    return faddishness++;
}

/**
 * @typedef {{
 *  lastModified: number,
 *  faddishness: number
 * }} TimestampComparable
 */

/**
 * @param {TimestampComparable} a
 * @param {TimestampComparable} b
 */
export function isOlder(a, b) {
    return (
        a.lastModified < b.lastModified ||
        (a.lastModified === b.lastModified && a.faddishness < b.faddishness)
    );
}

let syncHandler = () => {};

/**
 * @param {() => void} handler
 */
export function setSyncHandler(handler) {
    syncHandler = handler;
}

function scheduleSyncHandler() {
    syncScheduled = false;
    syncHandler();
}

let syncScheduled = false;
export function scheduleSync() {
    if (syncScheduled) {
        return;
    }
    syncScheduled = true;
    setImmediate(scheduleSyncHandler);
}
