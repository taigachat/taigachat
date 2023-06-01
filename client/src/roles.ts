import type { Immutable } from './immutable'
import type { Role } from './schema'

export function canRoles(
    permission: string,
    roleAssignments: readonly number[],
    context: Immutable<Role[][]>
) {
    // A set of roles which are applied to every user.
    const common: Record<number, boolean> = {}
    const rank: Record<number, number> = {}
    for (const role of context[0] || []) {
        if (role !== undefined && role.rank !== undefined) {
            rank[role.roleID] = role.rank
            if (role.common === true) {
                common[role.roleID] = true
            }
        }
    }

    // Determines if the role can have an effect.
    const relevant = (role: Immutable<Role>) => role !== undefined &&
        (roleAssignments.indexOf(role.roleID) !== -1 || common[role.roleID])

    // Can a set of roles perform an action in the context of certain role definitions.
    let can = false

    for (const roles of context) {
        if (roles) {
            for (const role of roles.filter(relevant).sort((a, b) => (rank[a.roleID] || 0) - (rank[b.roleID] || 0))) {
                if (role.allowed && role.allowed.indexOf(permission) !== -1) {
                    can = true
                }
                if (role.denied && role.denied.indexOf(permission) !== -1) {
                    can = false
                }
            }
        }
    }
    return can
}

export function calculatePermissionsInContext(assignments: readonly number[], context: Immutable<Role[][]>): Record<string, boolean> {
    // A set of roles which are applied to every user.
    const common: Record<number, boolean> = {}
    const rank: Record<number, number> = {}
    for (const role of context[0] || []) {
        if (role !== undefined && role.rank !== undefined) {
            rank[role.roleID] = role.rank
            if (role.common === true) {
                common[role.roleID] = true
            }
        }
    }

    const permissions: Record<string, boolean> = {}

    // Determines if the role can have an effect.
    const relevant = (role: Immutable<Role>) => role !== undefined &&
        (assignments.indexOf(role.roleID) !== -1 || common[role.roleID])

    for (const roles of context) {
        if (roles) {
            for (const role of roles.filter(relevant).sort((a, b) => (rank[a.roleID] || 0) - (rank[b.roleID] || 0))) {
                for(const permission of role.allowed || []) {
                    permissions[permission] = true
                }
                for(const permission of role.denied || []) {
                    permissions[permission] = false
                }
            }

        }
    }

    return permissions
}
