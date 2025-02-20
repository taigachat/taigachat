/**
 * @import { Server } from './store'
 */

/**
 * @import { Immutable } from './immutable'
 */

/**
 * @import { ServerUser } from './schema'
 */

/**
 * @typedef {{
 *  allowed: Set<string>,
 *  denied: Set<string>,
 * }} CachedPermissions
 */

/** @type {Map<string, CachedPermissions>} */
const rolesInSubdomainCache = new Map();

/** @type {Map<string, Set<string>>} */
const rolesInDomainCache = new Map();

/**
 * @typedef {{
 *  lastModified: number,
 *  faddishness: number,
 * }} TimestampComparable
 */

/** @type {Map<string, TimestampComparable>} */
const serverPermissionLastModified = new Map();

function resetPermissionCache() {
    rolesInSubdomainCache.clear();
    rolesInDomainCache.clear();
    serverPermissionLastModified.clear();
}

/**
 * @param {Immutable<Server>} server The server to which these rules belong.
 */
function tryInvalidateCache(server) {
    const cached = serverPermissionLastModified.get(server.serverID);
    if (cached === undefined) {
        return;
    }
    if (
        cached.lastModified !== server.domainPermissionsLastModified ||
        cached.faddishness !== server.domainPermissionsFaddishness
    ) {
        resetPermissionCache();
    }
}

/**
 * @param {Immutable<Server>} server The server to which these rules belong.
 * @param {string} subdomain The subdomain to compute the permissions for.
 * @param {string} roles A string of a JSON list of role IDs, i.e numbers in SORTED order.
 */
function permissionsForRolesInSubdomain(server, subdomain, roles) {
    tryInvalidateCache(server);

    const cacheKey = `${server.serverID}/${subdomain}/#${roles}`;
    const cachedResult = rolesInSubdomainCache.get(cacheKey);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    /** @type {Set<String>} */
    let allowed = new Set();

    /** @type {Set<String>} */
    let denied = new Set();

    const parsedRoles = JSON.parse(roles);
    for (const role of parsedRoles) {
        if (typeof role !== "number") {
            throw new Error("only numbers must exist in the user roles list");
        }
        //server.domainPermissions.find(e => )
        const row = server.domainPermissions.find((r) => r.roleID == role && r.subdomain == subdomain);
        if (row === undefined) {
            continue;
        }

        for (const perm of row.allowed) {
            allowed.add(perm);
            denied.delete(perm);
        }

        for (const perm of row.denied) {
            denied.add(perm);
            allowed.delete(perm);
        }
    }

    const result = {
        allowed,
        denied,
    };
    rolesInSubdomainCache.set(cacheKey, result);
    return result;
}

/**
 * @param {Immutable<Server>} server The server to which these rules belong.
 * @param {string} domain A slash separated list of subdomains in order. The global subdomain should always come first if present.
 * @param {string} roles A string of a JSON list of role IDs, i.e numbers in SORTED order.
 */
function permissionsForRolesInDomain(server, domain, roles) {
    tryInvalidateCache(server);

    const cacheKey = `${server.serverID}/${domain}/#${roles}`;
    const cachedResult = rolesInDomainCache.get(cacheKey);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    /** @type {Set<string>} */
    let permissions = new Set();

    const subdomains = domain.split("/");
    for (const subdomain of subdomains) {
        const states = permissionsForRolesInSubdomain(server, subdomain, roles);
        for (const perm of states.allowed) {
            permissions.add(perm);
        }
        for (const perm of states.denied) {
            permissions.delete(perm);
        }
    }

    rolesInDomainCache.set(cacheKey, permissions);
    return permissions;
}

/**
 * @param {Immutable<Server>} server The server for which to perform the check for.
 * @param {Immutable<ServerUser>} user What user we are checking permissions for.
 * @param {string} permission What permissions we want to be on for a return of true.
 * @param {string} domain Within what domain we are looking for permissions.
 */
export function domainAllows(server, user, permission, domain) {
    const allowed = permissionsForRolesInDomain(server, domain, user.roles);
    return allowed.has(permission);
}

/**
 * @param {Immutable<Server>} server The server for which to perform the check for.
 * @param {Immutable<ServerUser>} user What user we are checking permissions for.
 * @param {string} permission What permissions we want to be on for a return of true.
 * @param {number} roomID The roomID of the room we doing the check for.
 */
export function roomAllows(server, user, permission, roomID) {
    return domainAllows(server, user, permission, `global/textRoom.${roomID}`);
}
