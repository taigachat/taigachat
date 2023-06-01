<script lang="ts">
import type { Immutable } from '../immutable'
import type { DefinedPermission, Role, RolePermissionState } from '../schema'

export let role: Immutable<Role> | undefined
export let setPermission: (permission: string, state: RolePermissionState) => () => void
export let scopeFilter: string
export let definedPermissions: Immutable<DefinedPermission[]>

$: permissions = scopeFilter ? definedPermissions.filter((r) => r.scope === scopeFilter) : definedPermissions

$: allowed = (role && role.allowed) || []
$: denied = (role && role.denied) || []
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
    {#each permissions as permission}
        <div class="permission-entry">
            <div class="permission-title">
                {permission.title}
            </div>
            <div
                class="permission-box permission-allowed"
                class:selected={allowed.indexOf(permission.id) !== -1}
                on:click={setPermission(permission.id, 'allowed')} />
            <div
                class="permission-box permission-neutral"
                class:selected={allowed.indexOf(permission.id) === -1 &&
                    denied.indexOf(permission.id) === -1}
                on:click={setPermission(permission.id, 'neutral')} />
            <div
                class="permission-box permission-denied"
                class:selected={denied.indexOf(permission.id) !== -1}
                on:click={setPermission(permission.id, 'denied')} />
        </div>
    {/each}
</div>
