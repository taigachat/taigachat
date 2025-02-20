<script lang="ts">
import type { Immutable } from "../immutable";
import type { TextRoom } from "../store";
import type { Role, DefinedPermission, DomainPermission } from "../schema";
import { onServer } from "../actions";
import PermissionEditor from "./PermissionEditor.svelte";
import { encryptEndToEndKey } from "../auth";

export let room: Immutable<TextRoom>;
export let roomID: number;
export let serverID: string;
export let publicSalt: string;
export let definedPermissions: Immutable<Record<string, DefinedPermission>>;
export let domainPermissions: Immutable<DomainPermission[]>;
export let sortedServerRoles: Immutable<Role[]>;

let selectedRoleID: number = -1;

let roomNameInput: HTMLInputElement;
let roomDescriptionInput: HTMLInputElement;
let roomEncryptedByInput: HTMLInputElement;

function setRoomName() {
    onServer.setRoomName0(serverID, roomID, roomNameInput.value);
}

function setRoomDescription() {
    onServer.setRoomDescription0(serverID, roomID, roomDescriptionInput.value);
}

async function setRoomEncryptedBy() {
    if (roomEncryptedByInput.value.startsWith("v1e2e/")) {
        await onServer.setRoomEncryptedBy0(serverID, roomID, roomEncryptedByInput.value);
    } else {
        const fingerprint = await encryptEndToEndKey(roomEncryptedByInput.value, publicSalt, "");
        await onServer.setRoomEncryptedBy0(serverID, roomID, fingerprint);
    }
}

function deleteRoom() {
    onServer.deleteRoom0(serverID, roomID);
}

function clearRoomPermissions() {
    onServer.clearPermissionsInDomain0(serverID, "textRoom." + roomID);
}
</script>

<style>
.settings-room-name {
    padding: 5px;
    margin-bottom: 5px;
    font-size: 1.05em;
}

.room-permissions-editor {
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
.room-role-list {
    border-radius: 8px;
    margin: 10px;
}
.room-roles {
    padding-left: 10px;
}
</style>

<input
    class="panel-glass settings-room-name"
    value={room.name}
    bind:this={roomNameInput}
    on:change={setRoomName} />
<div>Description:</div>
<input
    class="panel-glass settings-room-name"
    value={room.description}
    bind:this={roomDescriptionInput}
    on:change={setRoomDescription} />
<br />

<div>Encryption:</div>
<div class="panel-glass">
    {room.encryptedBy}
</div>
<input
    class="panel-glass settings-room-name"
    bind:this={roomEncryptedByInput}
    on:change={setRoomEncryptedBy} />
<br />

<div>Permissions:</div>
<div class="room-permissions-editor">
    <div class="room-role-list">
        {#each sortedServerRoles as role}
            <button
                class:selected={role.roleID == selectedRoleID}
                class="role-list-entry"
                on:click={() => (selectedRoleID = role.roleID)}>
                {role.name}
            </button>
        {/each}
    </div>

    <div class="room-roles">
        {#if selectedRoleID !== -1}
            <PermissionEditor
                {serverID}
                roleID={selectedRoleID}
                subdomain={"textRoom." + roomID}
                scopeFilter="textRoom"
                {domainPermissions}
                {definedPermissions} />
        {/if}
    </div>
</div>

<button class="big-button yellow" on:click={clearRoomPermissions}>Clear Permissions</button>
<button class="big-button red" on:click={deleteRoom}>Delete Room</button>
