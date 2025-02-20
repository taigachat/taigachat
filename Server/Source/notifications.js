import { getLog } from "./log.ts";

/**
 * @import { Statement } from 'better-sqlite3'
 */

import { db } from "./db.js";

const { error, info } = getLog("notifications");

/**
 * @param {string} userID
 * @param {string} endpoint
 * @param {string} token
 */
export function addNotificationToken(userID, endpoint, token) {
    // Normalize the endpoint.
    // TODO: Perhaps do this in a better way?
    endpoint = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;

    /** @type {Statement<[string, string, string], {}>} */
    const stmt = db.prepare(
        "INSERT OR IGNORE INTO notification_tokens (user_id, endpoint, token) VALUES (?, ?, ?)"
    );
    stmt.run(userID, endpoint, token);
}

/**
 * @param {string} endpoint
 * @param {string} token
 */
function removeNotificationToken(endpoint, token) {
    /** @type {Statement<[string, string], {}>} */
    const stmt = db.prepare("DELETE FROM notification_tokens WHERE endpoint = ? AND token = ?");
    stmt.run(endpoint, token);
}

/**
 * @param {string[]} userIDs
 * @param {string} message
 */
export async function sendNotification(userIDs, message) {
    /** @type {Map<string, string[]>} */
    const destinations = new Map();

    /** @type {Statement<[string], {endpoint: string, token: string}>} */
    const stmt = db.prepare("SELECT endpoint, token FROM notification_tokens WHERE user_id = ?");
    for (const userID of userIDs) {
        const rows = stmt.all(userID);
        for (const row of rows) {
            let tokens = destinations.get(row.endpoint);
            if (tokens === undefined) {
                tokens = [row.token];
                destinations.set(row.endpoint, tokens);
            } else {
                tokens.push(row.token);
            }
        }
    }

    for (const [endpoint, tokens] of destinations.entries()) {
        try {
            const paramaters = new URLSearchParams();
            paramaters.set("message", message);
            paramaters.set("tokens", tokens.join(","));
            const removed = await fetch(`${endpoint}sendNotification0?${paramaters}`);
            const badTokens = await removed.text();
            if (badTokens.length == 0) {
                // All went well.
                continue;
            }

            // We must find the tokens that caused the error.
            for (const token of tokens) {
                if (badTokens.indexOf(token) !== -1) {
                    info("removing bad token", token);
                    removeNotificationToken(endpoint, token);
                }
            }
        } catch (e) {
            error(e);
            info(`could not send notification to ${endpoint}`);
        }
    }
}
