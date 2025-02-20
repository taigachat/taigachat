/**
 * @import { Statement } from 'better-sqlite3'
 */

import { db } from "./db.js";

/**
 * @import { UpdateObjectVariants } from './schema.js'
 */

import { lastModifiedPosition } from "./last_modified.js";

/**
 * @param {UpdateObjectVariants[]} results
 */
export function serverInfoUpdate(results) {
    /** @type {Statement<[], {last_modified: number, faddishness: number, name: string}>} */
    const stmt = db.prepare("SELECT last_modified, faddishness, name FROM server_info");
    const row = stmt.get();
    if (row === undefined) {
        return;
    }
    results.push({
        type: "serverInfo",
        lastModified: row.last_modified,
        faddishness: row.faddishness,
        data: {
            name: row.name,
        },
    });
}

/**
 * @param {string} name
 */
export function setServerName(name) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[number, number, string], {}>} */
    const stmt = db.prepare("UPDATE server_info SET last_modified = ?, faddishness = ?, name = ?");
    stmt.run(lastModified, faddishness, name);
}
