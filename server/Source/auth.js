"use strict";

import config from "./config.js";
import { fromBase64, toBase64 } from "./encoding_schemes.js";

/**
 * @import { Statement } from 'better-sqlite3'
 */

import { db } from "./db.js";

/**
 * @import {
 *  MainAuthMethod,
 *  UserIdentity
} from './schema.js' */

import { ECDSA_IDENTITY_ALGORITHM } from "./schema.ts";

let publicSaltString = "";

/** @type {Uint8Array|undefined} */
let publicSalt = undefined;

const encoder = new TextEncoder();

export function getPublicSaltString() {
    getPublicAuthSalt();
    return publicSaltString;
}

/**
 * Generates a public salt just for this server if one doesn't already exists.
 * @returns {Uint8Array}
 */
function getPublicAuthSalt() {
    if (publicSalt) {
        return publicSalt;
    }

    /** @type {Statement<[], {public_salt: string}>} */
    const stmt = db.prepare("SELECT public_salt FROM server_data");
    const row = stmt.get();

    if (row === undefined) {
        db.exec("INSERT OR IGNORE INTO server_data DEFAULT VALUES");
    }

    if (row && row.public_salt) {
        publicSaltString = row.public_salt;
        publicSalt = fromBase64(publicSaltString);
        return publicSalt;
    } else {
        // Perhaps some more care should be taken here...
        publicSalt = new Uint8Array(32);
        crypto.getRandomValues(publicSalt);
        const view = new DataView(publicSalt.buffer);
        view.setFloat64(0, Date.now(), false);

        publicSaltString = toBase64(publicSalt);

        /** @type {Statement<[string], {}>} */
        const updateStmt = db.prepare("UPDATE server_data SET public_salt = ?");
        updateStmt.run(publicSaltString);

        return publicSalt;
    }
}

/**
 * @returns {string}
 */
export function randomString() {
    const array = new Uint8Array(32);
    return toBase64(crypto.getRandomValues(array));
}

/**
 * @param {string} ip
 * @param {string} name
 * @returns {string}
 */
export function randomNonce(ip, name) {
    // TODO: Include a bunch of accepted address / urls. The client should then make sure that one of them is the one that we are connecting to. That will effectively prevent MITM attack.
    // TODO: Also warn if ip doesn't match local IP on the client side.
    // TODO: Also maybe there is an API for checking the used SSL cert. That information could also be used to prevent MITM.
    return `nonce ${Date.now()} ${randomString()} ${ip} ${name}`;
}

/**
 * @param {string} publicKeyRaw
 * @param {string} expectedNonce
 * @param {string} signedNonce
 * @returns {Promise<[string, UserIdentity]>}
 */
async function verifyEcdsaIdentity(publicKeyRaw, expectedNonce, signedNonce) {
    const publicKeyDecoded = fromBase64(publicKeyRaw);
    const expected = encoder.encode("tSAN" + expectedNonce);
    const key = await crypto.subtle.importKey("raw", publicKeyDecoded, ECDSA_IDENTITY_ALGORITHM, false, [
        "verify",
    ]);
    if (
        await crypto.subtle.verify(
            {
                name: "ECDSA",
                hash: { name: "SHA-384" },
            },
            key,
            fromBase64(signedNonce),
            expected
        )
    ) {
        return [
            "ecid1-" + publicKeyRaw,
            {
                ecdsaIdentity: {
                    publicKeyRaw,
                },
            },
        ];
    } else {
        throw "invalid ecdsa signature";
    }
}

/**
 * @param {string} guiseBase64
 * @returns {Promise<[string, UserIdentity]>}
 */
async function verifyGuestIdentity(guiseBase64) {
    // TODO: The client should tell what kind of authentications it is capable of perhaps.
    // TODO: So that we do not send things unnecessairly? (maybe, just a thought)

    const guise = fromBase64(guiseBase64);
    const publicSalt = getPublicAuthSalt();
    const arrayBuffer = new Uint8Array(publicSalt.length + guise.length);
    arrayBuffer.set(publicSalt, 0);
    arrayBuffer.set(guise, publicSalt.length);
    const hashedString = toBase64(
        await crypto.subtle.digest(
            {
                name: "SHA-384",
            },
            arrayBuffer
        )
    );

    const authID = "anon384-" + hashedString;
    return [
        authID,
        {
            guest: {},
        },
    ];
}

/**
 * @param {MainAuthMethod} auth
 * @param {string} expectedNonce
 * @returns {Promise<[string, UserIdentity]>}
 */
export function verifyMainAuth(auth, expectedNonce) {
    for (const method in auth) {
        if (config.okLoginMethods.indexOf(method) === -1 && method !== "expectedAuthID") {
            throw `login method "${method}" has not been enabled`;
        }
    }
    if ("ecdsaIdentity" in auth) {
        const { signedNonce, publicKeyRaw } = auth.ecdsaIdentity;
        return verifyEcdsaIdentity(publicKeyRaw, expectedNonce, signedNonce);
    }
    if ("guest" in auth) {
        return verifyGuestIdentity(auth.guest.identifier);
    }

    throw "missing valid auth method";
}

export async function unitTest() {
    // TODO: Do some unit tests here again!
    // TODO: Should probably be writtein in a seperate test file
}
