<script lang="ts">
import type { Immutable } from "../immutable";
import PermissionEditor from "./PermissionEditor.svelte";
import { onServer } from "../actions";
import type { Channel, DefinedPermission, DomainPermission, Role } from "../schema";

export let serverID: string;
export let channelID: number;
export let channel: Immutable<Channel>;
export let sortedServerRoles: Immutable<Role[]>;
export let definedPermissions: Immutable<Record<string, DefinedPermission>>;
export let domainPermissions: Immutable<DomainPermission[]>;

let channelNameInput: HTMLInputElement;

let selectedRoleID: number = -1;

function setChannelName() {
    onServer.setChannelName0(serverID, channelID, channelNameInput.value);
}

function deleteChannel() {
    onServer.deleteChannel0(serverID, channelID);
}

function clearChannelPermissions() {
    onServer.clearPermissionsInDomain0(serverID, "voiceChannel." + channelID);
}
</script>

<style>
.settings-channel-name {
    padding: 5px;
    margin-bottom: 5px;
    font-size: 1.05em;
}
.channel-permissions-editor {
    display: flex;
    flex-flow: row nowrap;
}
.role-list-entry {
    padding: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 256px;
    max-height: 100px;
    white-space: nowrap;
}
.role-list-entry.selected,
.role-list-entry:hover {
    background-color: var(--background-opacity);
}
.role-list-entry.selected:first-child,
.role-list-entry:hover:first-child {
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
}
.role-list-entry.selected:last-child,
.role-list-entry:hover:last-child {
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
}
.channel-role-list {
    border-radius: 8px;
    margin: 10px;
}
.channel-roles {
    padding-left: 10px;
}
</style>

<input
    class="panel-glass settings-channel-name"
    bind:this={channelNameInput}
    value={channel.name}
    on:change={setChannelName} />

<div>Permissions:</div>
<div class="channel-permissions-editor">
    <div class="channel-role-list panel-glass">
        {#each sortedServerRoles as role}
            <button
                class:selected={role.roleID == selectedRoleID}
                class="role-list-entry"
                on:click={() => (selectedRoleID = role.roleID)}>
                {role.name}
            </button>
        {/each}
    </div>

    <div class="channel-roles">
        {#if selectedRoleID !== -1}
            <PermissionEditor
                {serverID}
                roleID={selectedRoleID}
                subdomain={"voiceChannel." + channelID}
                scopeFilter="voiceChannel"
                {domainPermissions}
                {definedPermissions} />
        {/if}
    </div>
</div>

<button class="big-button yellow" on:click={clearChannelPermissions}>Clear Permissions</button>
<button class="big-button red" on:click={deleteChannel}>Delete Room</button>
