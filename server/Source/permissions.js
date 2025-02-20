import { db } from "./db.js";
import { lastModifiedPosition } from "./last_modified.js";

/**
 * @import { Statement } from 'better-sqlite3'
 */

/**
 * @import { UpdateObjectVariants } from './schema.ts'
 */

/**
 * @typedef {{
 *  allowed: number,
 *  denied: number,
 * }} CachedPermissions
 */

let permissionsLastModified = Date.now();
let permissionsFaddishness = 0;

export const PERM_JOIN_SERVER = 1 << 0;
export const PERM_READ_CHAT = 1 << 1;
export const PERM_EDIT_CHAT = 1 << 2;
export const PERM_WRITE_CHAT = 1 << 3;
export const PERM_RETRACT_CHAT = 1 << 4;
export const PERM_CLEAN_CHAT = 1 << 5;
export const PERM_EDIT_ROLES = 1 << 6;
export const PERM_JOIN_CHANNEL = 1 << 7;
export const PERM_EDIT_CHANNELS = 1 << 8;
export const PERM_RENAME_ROOM = 1 << 9; // TODO: Do we really need this one?
export const PERM_EDIT_ROOMS = 1 << 10;
export const PERM_EDIT_SERVER_INFO = 1 << 11;

export const definedPermissions = {
    joinServer: {
        title: "Join Server",
        scope: "global",
        bit: PERM_JOIN_SERVER,
    },
    readChat: {
        title: "Read Chat",
        scope: "textRoom",
        bit: PERM_READ_CHAT,
    },
    editChat: {
        title: "Edit Chat",
        scope: "textRoom",
        bit: PERM_EDIT_CHAT,
    },
    writeChat: {
        title: "Write Chat",
        scope: "textRoom",
        bit: PERM_WRITE_CHAT,
    },
    retractChat: {
        title: "Retract Chat",
        scope: "textRoom",
        bit: PERM_RETRACT_CHAT,
    },
    cleanChat: {
        title: "Clean Chat",
        scope: "textRoom",
        bit: PERM_CLEAN_CHAT,
    },
    editRoles: {
        title: "Edit Roles",
        scope: "global",
        bit: PERM_EDIT_ROLES,
    },
    joinChannel: {
        title: "Join Channel",
        scope: "voiceChannel",
        bit: PERM_JOIN_CHANNEL,
    },
    editChannels: {
        title: "Edit Channels",
        scope: "global",
        bit: PERM_EDIT_CHANNELS,
    },
    renameRoom: {
        title: "Rename Room",
        scope: "textRoom",
        bit: PERM_RENAME_ROOM,
    },
    editRooms: {
        title: "Edit Rooms",
        scope: "global",
        bit: PERM_EDIT_ROOMS,
    },
    editServerInfo: {
        title: "Edit Server Info",
        scope: "global",
        bit: PERM_EDIT_SERVER_INFO,
    },
};

/** @type {Map<string, CachedPermissions>} */
const rolesInSubdomainCache = new Map();

/** @type {Map<string, number>} */
const rolesInDomainCache = new Map();

export function resetPermissionCache() {
    rolesInSubdomainCache.clear();
    rolesInDomainCache.clear();
    permissionsLastModified = Date.now();
    permissionsFaddishness = lastModifiedPosition(permissionsLastModified);
}

/**
 * @param {string} subdomain The subdomain to compute the permissions for.
 * @param {string} roles A string of a JSON list of role IDs, i.e numbers in SORTED order.
 */
function permissionsForRolesInSubdomain(subdomain, roles) {
    const cacheKey = `${subdomain}/#${roles}`;
    const cachedResult = rolesInSubdomainCache.get(cacheKey);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    let allowed = 0;
    let denied = 0;

    /** @type {Statement<[number, string], {role_id: number, allowed: number, denied: number}>} */
    const stmt = db.prepare(
        "SELECT allowed, denied FROM permissions WHERE role_id = ? AND subdomain = ? LIMIT 1"
    );

    const computePermissions = db.transaction(function () {
        const parsedRoles = JSON.parse(roles);
        for (const role of parsedRoles) {
            if (typeof role !== "number") {
                throw new Error("only numbers must exist in the user roles list");
            }
            const row = stmt.get(role, subdomain);
            if (row === undefined) {
                continue;
            }

            allowed |= row.allowed;
            denied &= ~row.allowed;

            denied |= row.denied;
            allowed &= ~row.denied;
        }
    });
    computePermissions();

    const result = {
        allowed,
        denied,
    };
    rolesInSubdomainCache.set(cacheKey, result);
    return result;
}

/**
 * @param {string} domain A slash separated list of subdomains in order. The global subdomain should always come first if present.
 * @param {string} roles A string of a JSON list of role IDs, i.e numbers in SORTED order.
 */
function permissionsForRolesInDomain(domain, roles) {
    const cacheKey = `${domain}/#${roles}`;
    const cachedResult = rolesInDomainCache.get(cacheKey);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    let permissions = 0;

    const subdomains = domain.split("/");
    for (const subdomain of subdomains) {
        const states = permissionsForRolesInSubdomain(subdomain, roles);
        permissions |= states.allowed;
        permissions &= ~states.denied;
    }

    rolesInDomainCache.set(cacheKey, permissions);
    return permissions;
}

/**
 * @param {UpdateObjectVariants[]} results
 */
export function permissionUpdates(results) {
    /** @type {Statement<[], {role_id: number, subdomain: string, allowed: number, denied: number}>} */
    const stmt = db.prepare("SELECT role_id, subdomain, allowed, denied FROM permissions");
    const rows = stmt.all();

    for (const row of rows) {
        /** @type {string[]} */
        let allowed = [];

        /** @type {string[]} */
        let denied = [];

        for (const [permissionID, permission] of Object.entries(definedPermissions)) {
            if ((permission.bit & row.denied) === permission.bit) {
                denied.push(permissionID);
            } else if ((permission.bit & row.allowed) === permission.bit) {
                allowed.push(permissionID);
            }
        }

        results.push({
            type: "permission",
            lastModified: permissionsLastModified,
            faddishness: permissionsFaddishness,
            data: {
                roleID: row.role_id,
                subdomain: row.subdomain,
                allowed,
                denied,
            },
        });
    }
}

/** @type {Map<string, string>} */
const userRolesCache = new Map();

export function resetUserRolesCache() {
    userRolesCache.clear();
}

/**
 * @param {string} userID
 * @returns {string|undefined}
 */
function getUserRoles(userID) {
    const cachedResult = userRolesCache.get(userID);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    /** @type {Statement<[string], {roles: string}>} */
    const stmt = db.prepare("SELECT roles FROM users WHERE user_id = ?");
    const row = stmt.get(userID);
    if (row === undefined) {
        return undefined;
    }

    userRolesCache.set(userID, row.roles);
    return row.roles;
}

/**
 * @param {string} userID What user we are checking permissions for.
 * @param {number} bits What permissions we want to be on for a return of true.
 * @param {string} domain Within what domain we are looking for permissions.
 */
export function domainAllows(userID, bits, domain) {
    const userRoles = getUserRoles(userID);
    if (userRoles === undefined) {
        return false;
    }
    const allowedBits = permissionsForRolesInDomain(domain, userRoles);
    return (allowedBits & bits) === bits;
}

/**
 * @param {string} userID What user we are checking permissions for.
 * @param {number} bits What permissions we want to be on for a return of true.
 */
export function serverAllows(userID, bits) {
    // TODO: Perhaps everywhere would be more fitting than global? Or something else less universal.
    return domainAllows(userID, bits, "global");
}

/**
 * @param {string} userID What user we are checking permissions for.
 * @param {number} bits What permissions we want to be on for a return of true.
 * @param {number} channelID The channelID of the channel we doing the check for.
 */
export function channelAllows(userID, bits, channelID) {
    return domainAllows(userID, bits, `global/voiceChannel.${channelID}`);
}

/**
 * @param {string} userID What user we are checking permissions for.
 * @param {number} bits What permissions we want to be on for a return of true.
 * @param {number} roomID The roomID of the room we doing the check for.
 */
export function roomAllows(userID, bits, roomID) {
    return domainAllows(userID, bits, `global/textRoom.${roomID}`);
}
