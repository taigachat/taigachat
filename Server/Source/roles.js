import { lastModifiedPosition, scheduleSync } from "./last_modified.js";

/**
 * @import { RolePermissionState, UpdateObjectVariants } from './schema.js'
 */

import { db, ROLE_DEFAULT_ADMIN, ROLE_DEFAULT_ROLE } from "./db.js";

import { resetPermissionCache, definedPermissions, resetUserRolesCache } from "./permissions.js";

import { setLastModifiedToLatest } from "./updater.js";

/**
 * @import { Statement } from 'better-sqlite3'
 */

/**
 * Makes sure that the default roles have been created
 */
export function ensureDefaultRoles() {
    const rolesExist = db.prepare("SELECT 1 FROM roles LIMIT 1").get();
    if (rolesExist !== undefined) {
        // Roles already exist.
        return;
    }

    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[string, number, number, number], {}>} */
    const stmt = db.prepare(
        "INSERT INTO roles (title, flags, penalty, last_modified, faddishness) VALUES (?, ?, (SELECT COALESCE(MAX(penalty + 1), 0) FROM roles), ?, ?)"
    );

    /** @type {Statement<[number | bigint, number], {}>} */
    const stmtPerms = db.prepare(
        "INSERT INTO permissions (role_id, subdomain, allowed, denied) VALUES (?, 'global', ?, 0)"
    );

    const adminID = stmt.run("Admin", ROLE_DEFAULT_ADMIN, lastModified, faddishness).lastInsertRowid;
    stmtPerms.run(adminID, ~0);

    const modID = stmt.run("Mod", 0, lastModified, faddishness).lastInsertRowid;
    stmtPerms.run(modID, definedPermissions.cleanChat.bit);

    const everyoneID = stmt.run("Everyone", ROLE_DEFAULT_ROLE, lastModified, faddishness).lastInsertRowid;
    stmtPerms.run(
        everyoneID,
        definedPermissions.readChat.bit |
            definedPermissions.retractChat.bit |
            definedPermissions.writeChat.bit |
            definedPermissions.joinServer.bit |
            definedPermissions.editChat.bit |
            definedPermissions.joinChannel.bit
    );

    // Just in case.
    resetPermissionCache();
}

/**
 * @param {UpdateObjectVariants[]} results
 */
export function roleUpdates(results) {
    /** @type {Statement<[], {last_modified: number, faddishness: number, title: string, role_id: number, penalty: number, flags: number}>} */
    const stmt = db.prepare(
        "SELECT role_id, last_modified, faddishness, penalty, title, flags FROM roles ORDER BY penalty"
    );
    const rows = stmt.all();

    for (const row of rows) {
        results.push({
            type: "role",
            lastModified: row.last_modified,
            faddishness: row.faddishness,
            data: {
                roleID: row.role_id,
                name: row.title,
                penalty: row.penalty,
                defaultRole: (row.flags & ROLE_DEFAULT_ROLE) === ROLE_DEFAULT_ROLE,
                defaultAdminRole: (row.flags & ROLE_DEFAULT_ADMIN) === ROLE_DEFAULT_ADMIN,
            },
        });
    }
    setLastModifiedToLatest(results, "role");
}

/**
 * @param {number} roleID
 * @param {string} subdomain
 * @param {string} permission
 * @param {RolePermissionState} state
 */
export function setDomainPermission(roleID, subdomain, permission, state) {
    /** @type {Statement<[number, string], {}>} */
    const stmt = db.prepare("INSERT OR IGNORE INTO permissions (role_id, subdomain) VALUES (?, ?)");
    stmt.run(roleID, subdomain);

    const definition = definedPermissions[/** @type {keyof typeof definedPermissions} */ (permission)];
    if (definition === undefined) {
        throw "unknown permission";
    }

    const bit = definition.bit;

    if (state == "allowed") {
        /** @type {Statement<[number, number, number, string], {}>} */
        const stmtChange = db.prepare(
            "UPDATE permissions SET allowed = allowed | ?, denied = denied & ~? WHERE role_id = ? AND subdomain = ?"
        );
        stmtChange.run(bit, bit, roleID, subdomain);
    } else if (state === "denied") {
        /** @type {Statement<[number, number, number, string], {}>} */
        const stmtChange = db.prepare(
            "UPDATE permissions SET allowed = allowed & ~?, denied = denied | ? WHERE role_id = ? AND subdomain = ?"
        );
        stmtChange.run(bit, bit, roleID, subdomain);
    } else {
        /** @type {Statement<[number, number, number, string], {}>} */
        const stmtChange = db.prepare(
            "UPDATE permissions SET allowed = allowed & ~?, denied = denied & ~? WHERE role_id = ? AND subdomain = ?"
        );
        stmtChange.run(bit, bit, roleID, subdomain);
    }

    // TODO: If allowed = 0 and disallowed = 0 then everything is neutral and the policy should be deleted. Either using constraint or directly after UPDATE just do DELETE FROM WHERE allowed = ...

    resetPermissionCache();
    scheduleSync();
}

/**
 * @param {string} subdomain
 */
export function clearDomainPermissions(subdomain) {
    /** @type {Statement<[string], {}>} */
    const stmt = db.prepare("DELETE FROM permissions WHERE subdomain = ?");
    stmt.run(subdomain);
    resetPermissionCache();
    scheduleSync();
}

/**
 * @param {number} roleID
 * @param {string} name
 */
export function setServerRoleName(roleID, name) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[string, number, number, number], {}>} */
    const stmt = db.prepare(
        "UPDATE roles SET title = ?, last_modified = ?, faddishness = ? WHERE role_id = ?"
    );
    stmt.run(name, lastModified, faddishness, roleID);
    scheduleSync();
}

/**
 * @param {number} penaltyA
 * @param {number} penaltyB
 */
export function swapRolePenalty(penaltyA, penaltyB) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[number, number, number, number, number, number, number], {}>} */
    const stmt = db.prepare(
        "UPDATE roles SET last_modified = ?, faddishness = ?, penalty = CASE WHEN penalty = ? THEN ? ELSE ? END WHERE penalty = ? OR penalty = ?"
    );
    stmt.run(lastModified, faddishness, penaltyA, penaltyB, penaltyA, penaltyA, penaltyB);

    resetPermissionCache();
    scheduleSync();
}

export function createRole() {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[number, number], {}>} */
    const stmt = db.prepare(
        "INSERT INTO roles (title, flags, penalty, last_modified, faddishness) VALUES ('Unnamed', 0, (SELECT COALESCE(MAX(penalty + 1), 0) FROM roles), ?, ?)"
    );
    stmt.run(lastModified, faddishness);
    scheduleSync();
}

/**
 * @param {string} userID
 * @param {number} roleID
 */
export function giveServerRole(userID, roleID) {
    const addRole = db.transaction(function () {
        /** @type {Statement<[string], {roles: string}>} */
        const userStmt = db.prepare("SELECT roles FROM users WHERE user_id = ?");
        const userRow = userStmt.get(userID);
        if (userRow === undefined) {
            return;
        }

        // Adding [] and doing Json.parse is really fast compared to a split method map justParseInt.
        /** @type {any[]} */
        const oldRoles = JSON.parse(userRow.roles);

        /** @type {Statement<[], {role_id: number, penalty: number}>} */
        const rowStmt = db.prepare("SELECT role_id, penalty FROM roles ORDER BY penalty DESC, role_id DESC");
        const rows = rowStmt.all();

        /** @type {number[]} */
        const selectedRoles = [];
        for (const row of rows) {
            if (oldRoles.indexOf(row.role_id) !== -1 || row.role_id === roleID) {
                selectedRoles.push(row.role_id);
            }
        }

        const newRoles = JSON.stringify(selectedRoles);

        const lastModified = Date.now();
        const faddishness = lastModifiedPosition(lastModified);

        /** @type {Statement<[string, number, number, string], {}>} */
        const updateStmt = db.prepare(
            "UPDATE users SET roles = ?, last_modified = ?, faddishness = ? WHERE user_id = ?"
        );
        updateStmt.run(newRoles, lastModified, faddishness, userID);
    });
    addRole();

    resetUserRolesCache();
    scheduleSync();
}

/**
 * @param {string} userID
 * @param {number} roleID
 */
export function revokeServerRole(userID, roleID) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    /** @type {Statement<[number, number, number, string], {}>} */
    const stmt = db.prepare(
        "UPDATE users SET last_modified = ?, faddishness = ?, roles = json_remove(users.roles, (SELECT '$[' || json_each.key || ']' FROM json_each(users.roles) WHERE json_each.value = ?)) WHERE user_id = ?"
    );
    stmt.run(lastModified, faddishness, roleID, userID);
    resetUserRolesCache();
    scheduleSync();
}

/**
 * @param {number} roleID
 */
export function deleteRole(roleID) {
    // TODO: Perhaps we should also go to every user and remove the id from roles? But as long as we do not recycle role_id then current behaviour should be fine.

    /** @type {Statement<[number], {}>} */
    const stmt = db.prepare("DELETE FROM roles WHERE role_id = ?");
    stmt.run(roleID);

    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    const updateStmt = db.prepare(
        "UPDATE roles SET last_modified = ?, faddishness = ? WHERE role_id = (SELECT MIN(role_id) FROM roles LIMIT 1)"
    );
    updateStmt.run(lastModified, faddishness);

    resetPermissionCache();
    resetUserRolesCache();
    scheduleSync();
}

export function unitTest() {}
