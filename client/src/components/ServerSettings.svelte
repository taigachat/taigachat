<script lang="ts">
import RoomSettings from './RoomSettings.svelte'
import ChannelSettings from './ChannelSettings.svelte'
import PermissionEditor from './PermissionEditor.svelte'
import ParticipantsEntry from './ParticipantsEntry.svelte'
import Icon from './Icon.svelte'
import { back } from '../icons'
import { deleteServer, setServerConnectivityInfo } from '../store'
import { safeURL } from '../join_url'
import { navigateUp } from '../acts'
import type { Immutable } from '../immutable'
import type { Server, ClientUser } from '../store'
import { onServer } from '../actions'
import type { RolePermissionState } from '../schema'

export let server: Immutable<Server>
export let clientUsers: Immutable<Record<string, ClientUser>>
export let serverID: number
export let mobileLayout: boolean

$: profilesURL = safeURL(server.profilesURL)

const underCategory = ['Info', 'Roles', 'Rooms', 'Channels', 'Log', 'Reactions']
let selectedUnderCategory = 'Info'

let selectedRoomID = -1
let selectedRoleID = -1
let selectedChannelID = -1

$: selectedRole =
    selectedRoleID === -1 ? undefined : server.serverRoles.find((r) => r.roleID === selectedRoleID)
$: selectedRoom = selectedRoomID === -1 ? undefined : server.rooms[selectedRoomID]
$: selectedChannel =
    selectedChannelID === -1 ? undefined : server.channels.find((c) => c.channelID === selectedChannelID)

$: sortedServerRoles = server.serverRoles.slice().sort((b, a) => (a.rank || 0) - (b.rank || 0))

let showDebugInfo = false

function setServerPermission(permission: string, state: RolePermissionState) {
    return () => {
        onServer.setServerRolePermission0(serverID, selectedRoleID, permission, state)
    }
}

let roleNameInput: HTMLInputElement
let roleRankInput: HTMLInputElement

function setServerRoleName() {
    onServer.setRoleName0(serverID, selectedRoleID, roleNameInput.value)
}

function setServerRoleRank() {
    onServer.setRoleRank0(serverID, selectedRoleID, parseInt(roleRankInput.value))
}

function deleteServerRole() {
    onServer.deleteServerRole0(serverID, selectedRoleID)
}

function createNewRole() {
    onServer.newServerRole0(serverID)
}

function createNewRoom() {
    onServer.newRoom0(serverID)
}

function createNewChannel() {
    onServer.newChannel0(serverID)
}

let serverNameInput: HTMLInputElement

function setServerName() {
    onServer.setServerName0(serverID, serverNameInput.value)
}

function removeServer() {
    deleteServer(serverID)
}

function reconnectServer() {
    setServerConnectivityInfo(serverID, {...server.connectivityInfo})
}

async function copyTokenToClipboard() {
    try {
        await navigator.clipboard.writeText(server.connectivityInfo.token)
    } catch (err) {
        console.error('error while copying token to clipboard:', err)
        alert('could not copy token to clipboard')
    }
}

function notUndefined(o: any) {
    return o !== undefined
}

$: serverRooms = Object.entries(server.rooms)

function setConnectivityInfoUserID(userID: string) {
    return () => setServerConnectivityInfo(serverID, {
        ...server.connectivityInfo,
        token: '',
        userID,
    })
}

function toggleServerEnabled() {
    setServerConnectivityInfo(serverID, {
        ...server.connectivityInfo,
        enabled: !server.connectivityInfo.enabled,
    })
}

</script>

<style>
.server-settings {
    display: flex;
    height: 100%;
}

.server-settings-sections {
    display: flex;
    flex-flow: column nowrap;
}

.server-settings-category {
    padding: 10px;
}

.server-settings-category:hover,
.server-settings-category.selected {
    background-color: var(--background-opacity);
}

.server-settings-current {
    flex-grow: 1;
    height: 100%;
}

.server-padded-category {
    padding: 20px;
}

.server-roles-editor,
.server-rooms-editor,
.server-channels-editor {
    display: flex;
    flex-flow: row nowrap;
    height: 100%;
}

.subsettings-list {
    display: flex;
    flex-flow: column nowrap;
}
.subsettings-list-entry {
    width: 245px;
    padding: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
}
.subsettings-list-entry.selected,
.subsettings-list-entry:hover {
    background-color: var(--background-opacity);
}
.subsettings-list-header {
    padding: 10px;
    font-variation-settings: var(--bold-text);
}
.subsettings-list-add {
    display: inline-block;
    text-align: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    margin-left: 10px;
    background-color: var(--background-opacity);
    cursor: pointer;
}
.subsettings-list-add:hover {
    background-color: var(--background-opacity);
}

.settings-server-role-name {
    padding: 5px;
    margin-bottom: 5px;
    font-size: 1.05em;
}
.settings-server-role-rank {
    font-size: 1.05em;
    text-align: center;
    width: 50px;
}

.server-roles-role,
.server-rooms-room {
    flex-grow: 1;
    padding: 20px;
}

.settings-back {
    fill: var(--background-opacity);
}
.settings-back:hover {
    fill: var(--background-opacity);
}

.warning-text {
    color: var(--red1);
}

.connect-user-entry {
    display: flex;
    flex-flow: row nowrap;
}

.connect-user-entry > div {
    min-width: 300px;
}

.connectivity-info-user {
    padding: 16px;
}

.server-enabled {
    margin-top: 16px;
}

.mobile-server-settings {
    flex-flow: nowrap column;
}

</style>

{#if !mobileLayout}
    <div class="settings-back" on:click={navigateUp}>
        <Icon icon={back} size="32" />
    </div>
{/if}
<div class="server-settings" class:mobile-server-settings={mobileLayout}>
    <div class="server-settings-sections">
        {#each underCategory as category}
            <div
                class="server-settings-category"
                class:selected={selectedUnderCategory == category}
                on:click={() => (selectedUnderCategory = category)}>
                {category}
            </div>
        {/each}
    </div>
    <div class="server-settings-current">
        {#if selectedUnderCategory === 'Roles'}
            <div class="server-roles-editor">
                <div class="subsettings-list">
                    <div class="subsettings-list-header">
                        Roles:
                        <span class="subsettings-list-add" on:click={createNewRole}>+</span>
                    </div>
                    {#each sortedServerRoles as role}
                        <div
                            class:selected={role.roleID == selectedRoleID}
                            class="subsettings-list-entry"
                            on:click={() => (selectedRoleID = role.roleID)}>
                            {role.name}
                        </div>
                    {/each}
                </div>
                <div class="server-roles-role">
                    {#if selectedRole}
                        <input
                            class="panel-glass settings-server-role-name"
                            bind:this={roleNameInput}
                            value={selectedRole.name}
                            on:change={setServerRoleName} />
                        <br />
                        Rank:
                        <input
                            class="panel-glass settings-server-role-rank"
                            bind:this={roleRankInput}
                            on:change={setServerRoleRank}
                            value={selectedRole.rank} /><br />
                        <br />
                        <PermissionEditor
                            setPermission={setServerPermission}
                            role={selectedRole}
                            scopeFilter={''}
                            definedPermissions={server.definedPermissions} />
                        <button class="big-button red" on:click={deleteServerRole}>Delete</button>
                    {/if}
                </div>
            </div>
        {:else if selectedUnderCategory === 'Info'}
            <div class="server-padded-category">
                <input
                    class="panel-glass settings-server-role-name"
                    bind:this={serverNameInput}
                    value={server.serverInfo.name}
                    on:change={setServerName} />
                <br />
                <div>
                    URL: {server.connectivityInfo.url}
                </div>
                <div class="server-enabled">
                    Server Enabled
                    <div
                        class="toggle-switch"
                        class:toggled={server.connectivityInfo.enabled}
                        on:click={toggleServerEnabled}>
                        <div />
                    </div>
                </div>
                <div class="connectivity-info-user">
                    Connect to server with:
                    <div>
                        {#each Object.values(clientUsers).filter(notUndefined) as clientUser (clientUser && clientUser.userID)}
                            <div class="connect-user-entry">
                                <div>
                                    <ParticipantsEntry {profilesURL} userID={clientUser.userID} user={undefined} />
                                </div>
                                {#if clientUser.userID === server.connectivityInfo.userID}
                                    <button class="big-button blue disabled">
                                        Current
                                    </button>
                                {:else}
                                    <button class="big-button green" on:click={setConnectivityInfoUserID(clientUser.userID)}>
                                        Select
                                    </button>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>

                <div>
                    Show debug information
                    <div
                        class="toggle-switch"
                        class:toggled={showDebugInfo}
                        on:click={() => (showDebugInfo = !showDebugInfo)}>
                        <div />
                    </div>
                </div>

                {#if showDebugInfo}
                    <div class="warning-text">WARNING: This section is only intended for debugging</div>
                    Name: {server.serverInfo.name}<br />
                    Token: <span on:click={copyTokenToClipboard}>click to copy</span><br />
                    Local ID: {serverID}<br />
                    Used User ID:
                    <!-- TODO: Let user change this variable -->
                    <input
                        value={server.connectivityInfo.userID}
                        readonly={true}
                        class="panel-glass" /><br />
                    <button class="big-button red" on:click={removeServer}>Debug Remove Server</button>
                    <button class="big-button yellow" on:click={reconnectServer}>Force Reconnect</button>
                {/if}
            </div>
        {:else if selectedUnderCategory === 'Rooms'}
            <div class:server-rooms-editor={!mobileLayout}>
                <div class="subsettings-list">
                    <div class="subsettings-list-header">
                        Rooms:
                        <span class="subsettings-list-add" on:click={createNewRoom}>+</span>
                    </div>
                    {#each serverRooms as entries}
                        <div
                            class:selected={parseInt(entries[0]) == selectedRoomID}
                            class="subsettings-list-entry"
                            on:click={() => (selectedRoomID = parseInt(entries[0]))}>
                            # <span>{entries[1] && entries[1].name}</span>
                        </div>
                    {/each}
                </div>
                <div class="server-rooms-room">
                    {#if selectedRoom}
                        <RoomSettings
                            {serverID}
                            room={selectedRoom}
                            roomID={selectedRoomID}
                            definedPermissions={server.definedPermissions}
                            {sortedServerRoles} />
                    {/if}
                </div>
                <br />
                <br />
            </div>
        {:else if selectedUnderCategory === 'Channels'}
            <div class="server-channels-editor">
                <div class="subsettings-list">
                    <div class="subsettings-list-header">
                        Channels:
                        <span class="subsettings-list-add" on:click={createNewChannel}>+</span>
                    </div>
                    {#each server.channels as channel}
                        <div
                            class:selected={channel.channelID == selectedChannelID}
                            class="subsettings-list-entry"
                            on:click={() => (selectedChannelID = channel.channelID)}>
                            # <span>{channel.name}</span>
                        </div>
                    {/each}
                </div>
                <div class="server-rooms-room">
                    {#if selectedChannel}
                        <ChannelSettings
                            {serverID}
                            channelID={selectedChannelID}
                            channel={selectedChannel}
                            definedPermissions={server.definedPermissions}
                            {sortedServerRoles} />
                    {/if}
                </div>
            </div>
        {/if}
    </div>
</div>
