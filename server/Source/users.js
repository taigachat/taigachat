import { getLog } from "./log.ts";

import { lastModifiedPosition, scheduleSync } from "./last_modified.js";

/**
 * @import { MainAuthMethod, UpdateObjectVariants } from './schema.ts'
 */

import { verifyMainAuth } from "./auth.js";

/**
 * @import { Statement } from 'better-sqlite3'
 */

import { db, ROLE_DEFAULT_ADMIN, ROLE_DEFAULT_ROLE } from "./db.js";

import { toRadix64 } from "./schema.ts";

const { error, info } = getLog("server");

/**
 * @param {string} userID
 */
export function userWasActive(userID) {}

/**
 * @param {string} userID
 */
export function userGoesOnline(userID) {}

/**
 * @param {string} userID
 */
export function userGoesOffline(userID) {}

/**
 * @param {string} userID
 * @param {number} profileTimestamp
 */
export function userChangesProfile(userID, profileTimestamp) {
    // TODO: Reject profileTimestamps that are too far in the future.
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[number, number, number, string], {}>} */
    const stmt = db.prepare(
        "UPDATE users SET last_modified = ?, faddishness = ?, profile_timestamp = ? WHERE user_id = ?"
    );
    stmt.run(lastModified, faddishness, profileTimestamp, userID);
    scheduleSync();
}

/**
 * @param {MainAuthMethod} main
 * @param {MainAuthMethod[]} transfers
 * @param {string} expectedAuthID
 * @param {string} expectedNonce
 * @returns {Promise<string>}
 */
export async function loginWithTransfers(main, transfers, expectedAuthID, expectedNonce) {
    ///** @type {UserIdentity[]} */
    //const identities = [];

    const authSuccess = await verifyMainAuth(main, expectedNonce);

    if (authSuccess[0] !== expectedAuthID) {
        // Someone might be trying something funny.
        throw "actual authID did not match the expected authID";
    }

    /** @type {Statement<[string], {user_id: string}>} */
    const stmt = db.prepare("SELECT user_id FROM users WHERE auth_id = ?");
    const mainRow = stmt.get(authSuccess[0]);

    // Login was simple.
    if (mainRow !== undefined) {
        return mainRow.user_id;
    }

    const newPublicIdentity = JSON.stringify(authSuccess[1]);

    // We implicitly assume here that no auth_id in users has been revoked.
    /** @type {Statement<[string], {user_id: string}>} */
    const revokedStmt = db.prepare("SELECT user_id FROM revoked_login WHERE auth_id = ?");
    const checkRow = revokedStmt.get(authSuccess[0]);

    // Login has been revoked and can't be used.
    if (checkRow !== undefined) {
        throw "used identity has been replaced with another account identity";
    }

    // The main authID did not resolve to a known user.
    // Maybe we can transfer owenrship of an old userID from a previous authID to the main one?
    for (const transfer of transfers) {
        try {
            const otherLogin = await verifyMainAuth(transfer, expectedNonce);
            const row = stmt.get(otherLogin[0]);
            if (row === undefined) {
                continue;
            }

            const doTransfer = db.transaction(function () {
                /** @type {Statement<[string], {user_id: string, public_identity: string, prior_identities: string}>} */
                const moreInfoStmt = db.prepare(
                    "SELECT user_id, public_identity, prior_identities FROM users WHERE auth_id = ?"
                );
                const moreInfoRow = moreInfoStmt.get(otherLogin[0]);

                // Make sure that the row is still there.
                if (moreInfoRow === undefined) {
                    return;
                }

                // TODO: Perhaps do some verification. But not strictly necessary because client will do that upon receiving identities.
                const newPriorIdentities = JSON.stringify(
                    [JSON.parse(moreInfoRow.public_identity)].concat(JSON.parse(moreInfoRow.prior_identities))
                );

                const lastModified = Date.now();
                const faddishness = lastModifiedPosition(lastModified);

                /** @type {Statement<[string, string, string, number, number, string], {user_id: string}>} */
                const transferStmt = db.prepare(
                    "UPDATE users SET auth_id = ?, public_identity = ?, prior_identities = ?, last_modified = ?, faddishness = ? WHERE user_id = ?"
                );
                transferStmt.run(
                    authSuccess[0],
                    newPublicIdentity,
                    newPriorIdentities,
                    lastModified,
                    faddishness,
                    moreInfoRow.user_id
                );

                // We add the old authID to the revoked list so that an old client (that doesn't have the newer authID)
                // doesnt login and accidentally get an entire new userID. It is better to inform the user of what
                // has happened.

                /** @type {Statement<[string, string], {user_id: string}>} */
                const revokeStmt = db.prepare("INSERT INTO revoked_login (user_id, auth_id) VALUES (?, ?)");
                revokeStmt.run(moreInfoRow.user_id, otherLogin[0]);

                return moreInfoRow.user_id;
            });
            const newUserID = doTransfer();
            scheduleSync();
            if (newUserID) {
                // We could do a transfer so we use that from now on.
                return newUserID;
            }
        } catch (e) {
            error(e);
        }
    }

    // Since we know from before that login has not been revoked.
    // And that none of the transfers were successfull.
    // We can create a new user using this identity.
    const newUser = db.transaction(function () {
        const lastModified = Date.now();
        const faddishness = lastModifiedPosition(lastModified);

        /** @type {Statement<[number, number, string, number, number, string], {user_id_num: number}>} */
        const userStmt = db.prepare(
            "INSERT INTO users (last_modified, faddishness, user_id, auth_id, last_seen, first_joined, public_identity) VALUES (?, ?, 'TEMP' || random(), ?, ?, ?, ?) RETURNING user_id_num"
        );
        const userResult = userStmt.get(
            lastModified,
            faddishness,
            authSuccess[0],
            lastModified,
            lastModified,
            newPublicIdentity
        );
        if (userResult === undefined) {
            throw new Error("could not insert user");
        }
        const newUserID = toRadix64(userResult.user_id_num);

        let addRolesWithFlags = ROLE_DEFAULT_ROLE;

        /** @type {Statement<[], {}>} */
        const checkStmt = db.prepare("SELECT 1 FROM users LIMIT 2");
        if (checkStmt.all().length === 1) {
            // First user on server. Give the user all known admin roles.
            addRolesWithFlags |= ROLE_DEFAULT_ADMIN;
        }

        /** @type {Statement<[number], {role_id: number}>} */
        const roleStmt = db.prepare(
            "SELECT role_id FROM roles WHERE (flags & ?) <> 0 ORDER BY penalty DESC, role_id DESC"
        );
        const roles = JSON.stringify(roleStmt.all(addRolesWithFlags).map((r) => r.role_id));

        /** @type {Statement<[string, string, string], {}>} */
        const idStmt = db.prepare("UPDATE users SET user_id = ?, roles = ? WHERE auth_id = ?");
        idStmt.run(newUserID, roles, authSuccess[0]);

        return newUserID;
    });

    const userID = newUser();
    scheduleSync();
    return userID;
}

/**
 * @param {UpdateObjectVariants[]} results
 */
export function userUpdates(results) {
    /** @type {Statement<[], {last_modified: number, faddishness: number, user_id: string, last_seen: number, profile_timestamp: number, prior_identities: string, public_identity: string, roles: string}>} */
    const stmt = db.prepare(
        "SELECT user_id, last_modified, faddishness, last_seen, profile_timestamp, public_identity, prior_identities, roles FROM users ORDER BY last_modified DESC, faddishness DESC"
    );
    const rows = stmt.all();

    for (const row of rows) {
        const identities = JSON.parse(row.prior_identities);
        Array.prototype.push.call(identities, JSON.parse(row.public_identity));

        results.push({
            type: "user",
            lastModified: row.last_modified,
            faddishness: row.faddishness,
            data: {
                userID: row.user_id,
                lastSeen: Math.floor(row.last_seen / 1000),
                roles: row.roles,
                profileTimestamp: row.profile_timestamp,
                connected: 1, // TODO: Get actual value somewhere.
                identities,
            },
        });
    }
}
