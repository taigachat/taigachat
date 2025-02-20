<script lang="ts">
import { onServer } from "../actions";
import type { Immutable } from "../immutable";
import type { Server } from "../store";

export let userID: string;
export let server: Immutable<Server>;

let addMode = false;

$: user = server.users[userID];
$: assignedRoleIDs = user ? JSON.parse(user.roles) : [];
$: assignedRoles = server.roles.filter((r) => assignedRoleIDs.indexOf(r.roleID) !== -1 && !r.defaultRole);
$: assignableRoles = server.roles.filter((r) => assignedRoleIDs.indexOf(r.roleID) === -1);

function revokeRole(roleID: number) {
    return () => onServer.revokeServerRole0(server.serverID, userID, roleID);
}

function giveRole(roleID: number) {
    return () => onServer.giveServerRole0(server.serverID, userID, roleID);
}
</script>

<style>
.add-mode-button {
    border-radius: 50%;
    display: inline-block;
    width: 20px;
    line-height: 10px;
    padding: 5px;
    background-color: var(--background-opacity);
    text-align: center;
    color: var(--white1);
}
.add-mode-button:hover {
    background-color: var(--background-opacity);
}

.role-name {
    display: inline-block;
    line-height: 10px;
    padding: 5px 6px;
    margin-right: 5px;
    border-radius: 10px;
    background-color: var(--background-opacity);
}
.role-name:hover {
    background-color: var(--background-opacity);
}

.assigned-roles {
    margin-top: 10px;
}
.assignable-roles {
    margin-top: 10px;
    padding: 5px;
    border-radius: 5px;
}
</style>

<div>
    <div class="assigned-roles">
        {#each assignedRoles as role}
            <button class="role-name" on:click={revokeRole(role.roleID)}>{role.name}</button>
        {/each}
        {#if assignedRoles.length === 0}
            This user has no roles.
        {/if}
        <button class="add-mode-button" on:click={() => (addMode = !addMode)}>{addMode ? "-" : "+"}</button>
    </div>
    {#if addMode}
        <div class="assignable-roles">
            {#each assignableRoles as role}
                <button class="role-name" on:click={giveRole(role.roleID)}>{role.name}</button>
            {/each}
            {#if assignableRoles.length === 0}
                No more roles left to assign.
            {/if}
        </div>
    {/if}
</div>
