<script lang="ts">
import { onServer } from "../actions";
import type { Immutable } from "../immutable";
import type { DefinedPermission, DomainPermission, RolePermissionState } from "../schema";

export let serverID: string;
export let roleID: number;
export let subdomain: string;
export let scopeFilter: string;
export let domainPermissions: Immutable<DomainPermission[]>;
export let definedPermissions: Immutable<Record<string, DefinedPermission>>;
//export let setPermission: (permission: string, state: RolePermissionState) => () => void

$: listedPermissions = scopeFilter
    ? Object.entries(definedPermissions).filter((r) => r[1].scope === scopeFilter)
    : Object.entries(definedPermissions);

$: relevantAssignedPermissions = domainPermissions.filter(
    (p) => p.subdomain === subdomain && p.roleID === roleID
);
$: allowed = relevantAssignedPermissions.flatMap((p) => p.allowed);
$: denied = relevantAssignedPermissions.flatMap((p) => p.denied);

function setPermission(permission: string, state: RolePermissionState) {
    return function () {
        onServer.setPermissionInDomain0(serverID, roleID, subdomain, permission, state);
    };
}

//$: allowed = (role && role.allowed) || []
//$: denied = (role && role.denied) || []
</script>

<style>
.permission-entry {
    display: flex;
    flex-flow: row nowrap;
    padding: 8px;
    min-width: 200px;
}
.permission-title {
    flex-grow: 1;
    font-size: 1.1em;
    max-width: 500px;
}
.permission-box {
    margin: 2px;
    width: 20px;
    height: 20px;
    border: 2px solid black;
    border-radius: 5px;
}
.permission-allowed {
    border-color: var(--green1);
}
.permission-allowed.selected {
    background-color: var(--green1);
}
.permission-neutral {
    border-color: var(--blue1);
}
.permission-neutral.selected {
    background-color: var(--blue1);
}
.permission-denied {
    border-color: var(--red1);
}
.permission-denied.selected {
    background-color: var(--red1);
}
</style>

<div>
    {#each listedPermissions as permission}
        <div class="permission-entry">
            <div class="permission-title">
                {permission[1].title}
            </div>
            <button
                aria-label="allow"
                class="permission-box permission-allowed"
                class:selected={allowed.indexOf(permission[0]) !== -1}
                on:click={setPermission(permission[0], "allowed")}></button>
            <button
                aria-label="set as netural"
                class="permission-box permission-neutral"
                class:selected={allowed.indexOf(permission[0]) === -1 && denied.indexOf(permission[0]) === -1}
                on:click={setPermission(permission[0], "neutral")}></button>
            <button
                aria-label="denied"
                class="permission-box permission-denied"
                class:selected={denied.indexOf(permission[0]) !== -1}
                on:click={setPermission(permission[0], "denied")}></button>
        </div>
    {/each}
</div>
