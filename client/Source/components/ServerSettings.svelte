<script lang="ts">
import RoomSettings from "./RoomSettings.svelte";
import ChannelSettings from "./ChannelSettings.svelte";
import PermissionEditor from "./PermissionEditor.svelte";
import ParticipantsEntry from "./ParticipantsEntry.svelte";
import Icon from "./Icon.svelte";
import { back } from "../icons";
import { deleteServer, setServerConnectivityInfo } from "../store";
import type { Immutable } from "../immutable";
import type { Server, ClientUser, ListedServer } from "../store";
import { onServer } from "../actions";
import { closePage } from "../routes";

export let server: Immutable<Server>;
export let connectivityInfo: Immutable<ListedServer>;
export let clientUsers: Immutable<Record<string, ClientUser>>;
export let serverID: string; // TODO: Remove, we can find it in server
export let mobileLayout: boolean;
export let profilesModified: number;

const underCategory = ["Info", "Roles", "Rooms", "Channels", "Log", "Reactions"];
let selectedUnderCategory = "Info";

let selectedRoomID = -1;
let selectedRoleID = -1;
let selectedChannelID = -1;

$: selectedRole = selectedRoleID === -1 ? undefined : server.roles.find((r) => r.roleID === selectedRoleID);
$: selectedRoom = selectedRoomID === -1 ? undefined : server.rooms[selectedRoomID];
$: selectedChannel =
    selectedChannelID === -1 ? undefined : server.channels.find((c) => c.channelID === selectedChannelID);

$: sortedServerRoles = server.roles.slice().sort((b, a) => b.penalty - a.penalty);

let showDebugInfo = false;

let roleNameInput: HTMLInputElement;

function setServerRoleName() {
    onServer.setRoleName0(serverID, selectedRoleID, roleNameInput.value);
}

function moveRoleUp(penalty: number) {
    return function () {
        let otherPenalty = -1;
        for (const role of server.roles) {
            if (role.penalty > otherPenalty && role.penalty < penalty) {
                otherPenalty = role.penalty;
            }
        }
        if (otherPenalty !== -1) {
            onServer.swapRolePenalty0(serverID, penalty, otherPenalty);
        }
    };
}

function moveRoleDown(penalty: number) {
    return function () {
        let otherPenalty = Infinity;
        for (const role of server.roles) {
            if (role.penalty < otherPenalty && role.penalty > penalty) {
                otherPenalty = role.penalty;
            }
        }
        if (otherPenalty !== Infinity) {
            onServer.swapRolePenalty0(serverID, penalty, otherPenalty);
        }
    };
}

function deleteServerRole() {
    onServer.deleteServerRole0(serverID, selectedRoleID);
}

function createNewRole() {
    onServer.newServerRole0(serverID);
}

function createNewRoom() {
    onServer.newRoom0(serverID);
}

function createNewChannel() {
    onServer.newChannel0(serverID);
}

let serverNameInput: HTMLInputElement;

function setServerName() {
    onServer.setServerName0(serverID, serverNameInput.value);
}

function removeServer() {
    deleteServer(serverID);
}

function reconnectServer() {
    setServerConnectivityInfo(serverID, { ...connectivityInfo });
}

async function copyTokenToClipboard() {
    try {
        await navigator.clipboard.writeText(connectivityInfo.deviceID);
        // TODO: Copy something more important.
    } catch (err) {
        console.error("error while copying token to clipboard:", err);
        alert("could not copy token to clipboard");
    }
}

function notUndefined<T>(o: T | undefined): o is T {
    return o !== undefined;
}

$: serverRooms = Object.entries(server.rooms);

function setConnectivityInfoUserID(localUserID: string) {
    return () =>
        setServerConnectivityInfo(serverID, {
            ...connectivityInfo,
            localUserID,

            // Reset these so that we actually re-authenticate.
            deviceID: "",
            sessionID: "",
            sessionToken: "",
        });
}

function toggleServerEnabled() {
    setServerConnectivityInfo(serverID, {
        ...connectivityInfo,
        enabled: !connectivityInfo.enabled,
    });
}
</script>

<style>
.server-settings {
    display: flex;
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
    display: flex;
    flex-flow: row nowrap;
    justify-content: space-between;
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
    <button class="settings-back" onclick={closePage}>
        <Icon icon={back} size="32" />
    </button>
{/if}
<div class="server-settings" class:mobile-server-settings={mobileLayout}>
    <div class="server-settings-sections">
        {#each underCategory as category}
            <!-- TODO: perhaps some of the <button>'s should actually be <a>'s -->
            <button
                class="server-settings-category"
                class:selected={selectedUnderCategory == category}
                onclick={() => (selectedUnderCategory = category)}>
                {category}
            </button>
        {/each}
    </div>
    <div class="server-settings-current">
        {#if selectedUnderCategory === "Roles"}
            <div class="server-roles-editor">
                <div class="subsettings-list">
                    <div class="subsettings-list-header">
                        Roles:
                        <button aria-label="new role" class="subsettings-list-add" onclick={createNewRole}
                            >+</button>
                    </div>
                    {#each sortedServerRoles as role}
                        <div
                            role="button"
                            tabindex="0"
                            class:selected={role.roleID == selectedRoleID}
                            class="subsettings-list-entry"
                            onkeyup={(k) => {
                                if (k.key === "Enter") selectedRoleID = role.roleID;
                            }}
                            onclick={() => (selectedRoleID = role.roleID)}>
                            {role.name}

                            <div>
                                <button onclick={moveRoleUp(role.penalty)}>&#8593;</button>
                                <button onclick={moveRoleDown(role.penalty)}>&#8595;</button>
                            </div>
                        </div>
                    {/each}
                </div>
                <div class="server-roles-role">
                    {#if selectedRole}
                        <input
                            class="panel-glass settings-server-role-name"
                            bind:this={roleNameInput}
                            value={selectedRole.name}
                            onchange={setServerRoleName} />
                        <br />
                        Penalty: {selectedRole.penalty}
                        <br />
                        <PermissionEditor
                            {serverID}
                            roleID={selectedRoleID}
                            subdomain="global"
                            scopeFilter=""
                            domainPermissions={server.domainPermissions}
                            definedPermissions={server.definedPermissions} />
                        <button class="big-button red" onclick={deleteServerRole}>Delete</button>
                    {/if}
                </div>
            </div>
        {:else if selectedUnderCategory === "Info"}
            <div class="server-padded-category">
                <input
                    class="panel-glass settings-server-role-name"
                    bind:this={serverNameInput}
                    value={server.serverInfo.name}
                    onchange={setServerName} />
                <br />
                <div>
                    URL: {connectivityInfo.url}
                </div>
                <div class="server-enabled">
                    Server Enabled
                    <button
                        aria-label="toggle server enabled"
                        class="toggle-switch"
                        class:toggled={connectivityInfo.enabled}
                        onclick={toggleServerEnabled}>
                        <div></div>
                    </button>
                </div>
                <div class="connectivity-info-user">
                    Connect to server with:
                    <div>
                        {#each Object.values(clientUsers).filter(notUndefined) as clientUser (clientUser.localID)}
                            <div class="connect-user-entry">
                                <div>
                                    <!-- TODO: create a LocalUserEntry instead -->
                                    <ParticipantsEntry
                                        {serverID}
                                        {profilesModified}
                                        userID={clientUser.localID}
                                        user={undefined} />
                                </div>
                                {#if clientUser.localID === connectivityInfo.localUserID}
                                    <button class="big-button blue disabled"> Current </button>
                                {:else}
                                    <button
                                        class="big-button green"
                                        onclick={setConnectivityInfoUserID(clientUser.localID)}>
                                        Select
                                    </button>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>

                <div>
                    Show debug information
                    <button
                        aria-label="toggle show debug information"
                        class="toggle-switch"
                        class:toggled={showDebugInfo}
                        onclick={() => (showDebugInfo = !showDebugInfo)}>
                        <div></div>
                    </button>
                </div>

                {#if showDebugInfo}
                    <div class="warning-text">WARNING: This section is only intended for debugging</div>
                    Name: {server.serverInfo.name}<br />
                    Token: <button onclick={copyTokenToClipboard}>click to copy</button><br />
                    Local ID: {serverID}<br />
                    Used User ID:
                    <!-- TODO: Let user change this variable -->
                    <input value={connectivityInfo.localUserID} readonly={true} class="panel-glass" /><br />
                    <button class="big-button red" onclick={removeServer}>Debug Remove Server</button>
                    <button class="big-button yellow" onclick={reconnectServer}>Force Reconnect</button>
                {/if}
            </div>
        {:else if selectedUnderCategory === "Rooms"}
            <div class:server-rooms-editor={!mobileLayout}>
                <div class="subsettings-list">
                    <div class="subsettings-list-header">
                        Rooms:
                        <button class="subsettings-list-add" onclick={createNewRoom}>+</button>
                    </div>
                    {#each serverRooms as entries}
                        <button
                            class:selected={parseInt(entries[0]) == selectedRoomID}
                            class="subsettings-list-entry"
                            onclick={() => (selectedRoomID = parseInt(entries[0]))}>
                            <span># <span>{entries[1] && entries[1].name}</span></span>
                        </button>
                    {/each}
                </div>
                <div class="server-rooms-room">
                    {#if selectedRoom}
                        <RoomSettings
                            {serverID}
                            room={selectedRoom}
                            roomID={selectedRoomID}
                            publicSalt={server.publicSalt}
                            definedPermissions={server.definedPermissions}
                            domainPermissions={server.domainPermissions}
                            {sortedServerRoles} />
                    {/if}
                </div>
                <br />
                <br />
            </div>
        {:else if selectedUnderCategory === "Channels"}
            <div class="server-channels-editor">
                <div class="subsettings-list">
                    <div class="subsettings-list-header">
                        Channels:
                        <button class="subsettings-list-add" onclick={createNewChannel}>+</button>
                    </div>
                    {#each server.channels as channel}
                        <button
                            class:selected={channel.channelID == selectedChannelID}
                            class="subsettings-list-entry"
                            onclick={() => (selectedChannelID = channel.channelID)}>
                            <span># <span>{channel.name}</span></span>
                        </button>
                    {/each}
                </div>
                <div class="server-rooms-room">
                    {#if selectedChannel}
                        <ChannelSettings
                            {serverID}
                            channelID={selectedChannelID}
                            channel={selectedChannel}
                            definedPermissions={server.definedPermissions}
                            domainPermissions={server.domainPermissions}
                            {sortedServerRoles} />
                    {/if}
                </div>
            </div>
        {/if}
    </div>
</div>
