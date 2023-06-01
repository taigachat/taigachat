import { assertStrictEquals } from 'https://deno.land/std@0.127.0/testing/asserts.ts';
import { documentChanged, DocumentSavable, openDocSingleton } from './json.ts'
import type { RolePermissionState, Role } from './schema.ts'

export const serverDefinedPermissions = [
    {
        id: 'join_channel',
        title: 'Join Channel',
        scope: 'voice_channel',
    },
    {
        id: 'edit_roles',
        title: 'Edit Roles',
        scope: 'global',
    },
    {
        id: 'edit_channels',
        title: 'Edit Channels',
        scope: 'global',
    },
    {
        id: 'read_chat',
        title: 'Read Chat',
        scope: 'text_room',
    },
    {
        id: 'write_chat',
        title: 'Write Chat',
        scope: 'text_room',
    },
    {
        id: 'retract_chat',
        title: 'Retract Chat',
        scope: 'text_room',
    },
    {
        id: 'edit_chat',
        title: 'Edit Chat',
        scope: 'text_room',
    },
    {
        id: 'clean_chat',
        title: 'Clean Chat',
        scope: 'text_room',
    },
    {
        id: 'rename_room',
        title: 'Rename Room',
        scope: 'text_room',
    },
    {
        id: 'join_server',
        title: 'Join Server',
        scope: 'global',
    },
    {
        id: 'edit_rooms',
        title: 'Edit Rooms',
        scope: 'global',
    },
    {
        id: 'edit_server_info',
        title: 'Edit Server Info',
        scope: 'global',
    },
]

export function setPermissionOnObject(obj: Role, permission: string, state: RolePermissionState) {
    obj.allowed = obj.allowed
        ? obj.allowed.filter(p => p !== permission)
        : []

    obj.denied = obj.denied
        ? obj.denied.filter(p => p !== permission)
        : []

    if (state === 'allowed') {
        obj.allowed.push(permission)
    } else if (state === 'denied') {
        obj.denied.push(permission)
    }
}

type StoredUserRoles = Record<string, number[]>
export let roleAssignmentsSavable: DocumentSavable<StoredUserRoles>
let roleAssignments: StoredUserRoles

const defaultServerRoles = {
    list: [
        {
            name: 'Admin',
            roleID: 2,
            rank: 3,
            defaultAdmin: true,
            allowed: serverDefinedPermissions.map((p) => p.id),
        },
        {
            name: 'Mod',
            roleID: 1,
            rank: 2,
            allowed: ['clean_chat'],
        },
        {
            name: 'Everyone',
            roleID: 0,
            rank: 0,
            common: true,
            allowed: [
                'read_chat',
                'retract_chat',
                'write_chat',
                'join_server',
                'edit_chat',
                'join_channel',
            ],
        },
    ] as Role[],
    deleted: {} as Record<number, boolean>,
    nextID: 3,
}
type StoredServerRoles = typeof defaultServerRoles
export let serverRolesSavable: DocumentSavable<StoredServerRoles>
let serverRoles: StoredServerRoles

export function setServerRolePermission(roleID: number, permission: string, state: RolePermissionState) {
    for (const role of serverRoles.list) {
        if (role.roleID == roleID) {
            //console.log('state is:', state, permission)
            setPermissionOnObject(role, permission, state)
            documentChanged(serverRolesSavable)
        }
    }
}

export function setServerRoleName(roleID: number, name: string) {
    for (const role of serverRoles.list) {
        if (role.roleID == roleID) {
            role.name = name
            documentChanged(serverRolesSavable)
        }
    }
}

export function setServerRoleRank(roleID: number, rank: number) {
    for (const role of serverRoles.list) {
        if (role.roleID == roleID) {
            role.rank = rank
            documentChanged(serverRolesSavable)
        }
    }
}

export function findDefaultAdminRoleID() {
    for (const role of serverRoles.list) {
        if (role.defaultAdmin) {
            return role.roleID
        }
    }
    return undefined
}

export function createRole() {
    //console.log('roleID: ', serverRoles.nextID)
    serverRoles.list.push({
        roleID: serverRoles.nextID++,
        name: 'Unnamed Role',
        rank: 1,
    })
    documentChanged(serverRolesSavable)
}

export function giveServerRole(userID: string, roleID: number) {
    let roles = roleAssignments[userID]
    if (roles === undefined) {
        roles = roleAssignments[userID] = []
    }
    roles.push(roleID)
    documentChanged(roleAssignmentsSavable)
}

export function revokeServerRole(userID: string, roleID: number) {
    const roles = roleAssignments[userID]
    if (!roles) {
        throw 'this userID has not yet joined'
    }
    roleAssignments[userID] = roles.filter((r: any) => r !== roleID)
    documentChanged(roleAssignmentsSavable)
}

export function deleteRole(roleID: number) {
    serverRoles.list = serverRoles.list.filter(
        (role: any) => role.roleID !== roleID
    )
    serverRoles.deleted[roleID] = true
    documentChanged(serverRolesSavable)
}

export function canUserInContext(permission: string, userID: string, categoryRoles?: any[], roomRoles?: any[]) {
    //console.trace('checking', userID, 'for', permission)

    // Get roles.
    let userRoleAssignments = roleAssignments[userID] || []

    const deleted = serverRoles.deleted

    // A set of roles which are applied to every user.
    const rank: Map<number, number> = new Map()
    const common: Map<number, boolean> = new Map()
    for (const role of serverRoles.list) {
        rank.set(role.roleID, role.rank || -Infinity)
        if (role.common === true) {
            common.set(role.roleID, true)
        }
    }

    // TODO: Make sure roomRoles is sent in if scope is text_chat

    // Determines if the role can have an effect.
    function relevant (role: Role) {
        return !(Object.hasOwn(deleted, role.roleID))
                && (userRoleAssignments.indexOf(role.roleID) !== -1
                    || common.get(role.roleID))
        // TODO: use Map instead
    }

    // Can a set of roles perform an action in the context of certain role definitions.
    let can = false

    function testContext(roles?: Role[]) {
        if (roles === undefined) {
            return
        }
        for (const role of roles
            .filter(relevant)
            .sort((a, b) => rank.get(a.roleID)! - rank.get(b.roleID)!)) {
            if (role.allowed && role.allowed.indexOf(permission) !== -1) {
                can = true
            }
            if (
                role.denied &&
                role.denied.indexOf(permission) !== -1
            ) {
                can = false
            }
        }

    }

    testContext(serverRoles.list)
    testContext(categoryRoles)
    testContext(roomRoles)

    return can
}

export function canUserGlobally(permission: string, userID: string) {
    return canUserInContext(permission, userID, [], [])
}

function isEmpty(obj: any) {
    for (const _ in obj) {
        return false
    }
    return true
}

export function firstRoleAssignment() {
    return isEmpty(roleAssignments)
}

export async function loadData() {
    {
        const container = openDocSingleton('userRoles', {})
        const entry = await container.open()
        roleAssignmentsSavable = [container, entry]
        roleAssignments = entry.data
    }
    {
        const container = openDocSingleton('serverRoles', defaultServerRoles)
        const entry = await container.open()
        serverRolesSavable = [container, entry]
        serverRoles = entry.data
    }
}

export function unitTest() {
    function roleTest(perm: string, roles: any, arr: any, deleted: any) {
        const oldServerRoles = serverRoles
        roleAssignments ||= {}
        roleAssignments[''] = roles
        serverRoles = {
            nextID: 0,
            list: arr[0] || [],
            deleted,
        }
        const result = canUserInContext(perm, '', arr[1], arr[2])
        serverRoles = oldServerRoles
        return result
    }
    assertStrictEquals(roleTest('read_chat', [], [], {}), false)
    assertStrictEquals(
        roleTest(
            'read_chat',
            [0],
            [
                [
                    {
                        roleID: 0,
                        rank: 1,
                        allowed: ['read_chat'],
                    },
                ],
            ],
            {}
        ),
        true
    )
    assertStrictEquals(
        roleTest(
            'read_chat',
            [1],
            [
                [
                    {
                        roleID: 0,
                        rank: 1,
                        allowed: ['read_chat'],
                    },
                ],
            ],
            {}
        ),
        false
    )
    assertStrictEquals(
        roleTest(
            'read_chat',
            [0],
            [
                [
                    {
                        roleID: 0,
                        rank: 1,
                        disallowed: ['read_chat'],
                    },
                ],
            ],
            {}
        ),
        false
    )
    assertStrictEquals(
        roleTest(
            'read_chat',
            [0],
            [
                [
                    {
                        roleID: 0,
                        rank: 1,
                        disallowed: ['read_chat'],
                    },
                    {
                        roleID: 0,
                        rank: 2,
                        allowed: ['read_chat'],
                    },
                ],
            ],
            {}
        ),
        true
    )
    assertStrictEquals(
        roleTest(
            'read_chat',
            [0],
            [
                [
                    {
                        roleID: 0,
                        rank: 1,
                        allowed: ['read_chat'],
                    },
                    {
                        roleID: 0,
                        rank: 2,
                        disallowed: ['read_chat'],
                    },
                ],
            ],
            {}
        ),
        false
    )
    assertStrictEquals(
        roleTest(
            'read_chat',
            [0],
            [
                [
                    {
                        roleID: 0,
                        rank: 1,
                        allowed: ['read_chat'],
                    },
                    {
                        roleID: 0,
                        rank: 2,
                        disallowed: ['read_chat'],
                    },
                ],
                [
                    {
                        roleID: 0,
                        rank: 1,
                        allowed: ['read_chat'],
                    },
                ],
            ],
            {}
        ),
        true
    )
    assertStrictEquals(
        roleTest(
            'read_chat',
            [0],
            [
                [
                    {
                        roleID: 0,
                        rank: 1,
                        disallowed: ['read_chat'],
                    },
                    {
                        roleID: 1,
                        common: true,
                        rank: 2,
                        allowed: ['read_chat'],
                    },
                ],
            ],
            {}
        ),
        true
    )
    assertStrictEquals(
        roleTest(
            'read_chat',
            [0],
            [
                [
                    {
                        roleID: 0,
                        rank: 1,
                        disallowed: ['read_chat'],
                    },
                    {
                        roleID: 1,
                        common: true,
                        rank: 2,
                        allowed: ['read_chat'],
                    },
                ],
            ],
            { 1: 1 }
        ),
        false
    )
}
