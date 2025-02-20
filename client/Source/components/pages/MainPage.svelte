<script lang="ts">
import LeftPanel from "../LeftPanel.svelte";
import ChatRoom from "../ChatRoom.svelte";
import RightPanel from "../RightPanel.svelte";
import ServerPanel from "../ServerPanel.svelte";

import { safeURL } from "../../join_url";
import { roomAllows } from "../../permissions";
import type { Immutable } from "../../immutable";
import { setServerViewedRoomID } from "../../store";
import type { MainStore, RankCategory } from "../../store";
import { navigateTo, setPopup } from "../../routes";

export let mainStore: Immutable<MainStore>;
export let viewedServerID: string;
export let viewedRoomID: number;
export let mobileLayout: boolean;
export let profilesModified: number;

$: viewedServer = mainStore.servers[viewedServerID];
$: viewedServerConnectivityInfo = mainStore.listedServers[viewedServerID];
$: viewedRoom = viewedServer ? viewedServer.rooms[viewedRoomID] : undefined;
$: viewedServerUserID = viewedServer ? viewedServer.userID : "";
$: lastActivityCheck = mainStore.lastActivityCheck;
$: viewedServerAttachmentsURL = safeURL(viewedServer && viewedServer.attachmentsURL);
$: viewedServerUsers = viewedServer ? viewedServer.users : {};

$: if (viewedServer && viewedServer.viewedRoomID !== viewedRoomID) {
    setServerViewedRoomID(viewedServerID, viewedRoomID);
}

let usersInViewedRoom: string[] = [];
let participantsInViewedRoom: RankCategory[];

$: if (viewedRoom !== undefined && viewedServer !== undefined) {
    // TODO: Perhaps this computation should be done elsewhere as it is quite verbose.

    const usersInRoom: string[] = [];

    const userByRoles: Record<number, RankCategory> = {};

    // TODO: Really, this code could be simplified. For starters, all users have the everyone role, and the rest are an anomaly.
    // Everyone could simply renamed to Online during this step. As for Offline users we could simply add it to userByRoles.
    const onlineRanklessUsers: RankCategory = { name: "Online", penalty: Infinity, users: [] };
    const offlineUsers: RankCategory = { name: "Offline", penalty: Infinity, users: [] };

    // TODO: The above if statement seems quite unnecessary

    for (const role of viewedServer.roles) {
        userByRoles[role.roleID] = {
            name: role.name || "",
            penalty: role.penalty,
            users: [],
        };
    }

    console.log(viewedServerUsers.length);
    for (const userID in viewedServerUsers) {
        const user = viewedServerUsers[userID]!;

        if (roomAllows(viewedServer, user, "readChat", viewedRoomID)) {
            // TODO: Do we really need a separate entry? Could we not just send in the user object directly?
            usersInRoom.push(userID);
            if (user.connected > 0) {
                const roleAssignments = JSON.parse(user.roles);
                const highestRole = roleAssignments[roleAssignments.length - 1];
                if (typeof highestRole === "number" && highestRole in userByRoles) {
                    userByRoles[highestRole]!.users.push(user);
                } else {
                    onlineRanklessUsers.users.push(user);
                }
            } else {
                offlineUsers.users.push(user);
            }
        }
    }

    const sortedRanks = Object.values(userByRoles)
        .filter((e) => e.users.length > 0)
        .sort((a, b) => a.penalty - b.penalty);

    participantsInViewedRoom = [...sortedRanks, onlineRanklessUsers, offlineUsers];
    usersInViewedRoom = usersInRoom;
} else {
    participantsInViewedRoom = [];
    usersInViewedRoom = [];
}

function addServerPopup() {
    setPopup({ addServer: true });
}
</script>

<style>
.panels {
    display: flex;
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    flex-grow: 1;
    flex-flow: row nowrap;
}

.server-list {
    width: 340px;
    flex-shrink: 0;
}

.maybe-chat-room {
    flex-grow: 1;
    min-width: 0;
}

.right-panel {
    width: 200px;
    flex-shrink: 0;
}

.pick-server-entry {
    font-size: 1.2em;
    padding: 6px;
    display: flex;
    flex-flow: row nowrap;
}

.mobile-server-list {
    display: flex;
    flex-flow: column nowrap;
}
.add-server-container {
    display: flex;
    flex-flow: row nowrap;
    justify-content: center;
}
</style>

{#if mobileLayout}
    {#if viewedRoom}
        <ChatRoom
            layout={mainStore.layout}
            endToEndEncryptionKeys={mainStore.endToEndEncryptionKeys}
            users={viewedServerUsers}
            attachmentsURL={viewedServerAttachmentsURL}
            {profilesModified}
            usersInRoom={usersInViewedRoom}
            roomID={viewedRoomID}
            serverID={viewedServerID}
            currentUserID={viewedServerUserID}
            messageTimeFormat={mainStore.miscConfig.messageTimeFormat}
            room={viewedRoom} />
    {:else if viewedServer && viewedServerConnectivityInfo}
        <ServerPanel
            {profilesModified}
            connectivityInfo={viewedServerConnectivityInfo}
            users={viewedServerUsers}
            server={viewedServer}
            voice={mainStore.voice}
            activeVoiceServer={mainStore.servers[mainStore.voice.activeServerID]} />
    {:else}
        <div class="mobile-server-list">
            {#each Object.keys(mainStore.listedServers) as serverID}
                {@const server = mainStore.servers[serverID]}
                <button
                    class="pick-server-entry panel-border panel-glass"
                    on:click={() => navigateTo({ name: "view-server", serverID })}>
                    {#if server}
                        <img height="48" src={server.icon} alt={server.serverInfo.name} />
                        <div>
                            {server.serverInfo.name}
                        </div>
                    {/if}
                </button>
            {/each}
            <div class="add-server-container">
                <button class="big-button green" on:click={addServerPopup}>Add Server</button>
            </div>
        </div>
    {/if}
{:else}
    <div class="panels">
        <div class="server-list">
            <!-- TODO: use real value instead profilesURL -->
            <LeftPanel
                voice={mainStore.voice}
                {profilesModified}
                listedServers={mainStore.listedServers}
                {viewedServerID}
                servers={mainStore.servers}
                users={viewedServerUsers} />
        </div>
        <div class="maybe-chat-room">
            {#if viewedRoom}
                <ChatRoom
                    layout={mainStore.layout}
                    endToEndEncryptionKeys={mainStore.endToEndEncryptionKeys}
                    users={viewedServerUsers}
                    attachmentsURL={viewedServerAttachmentsURL}
                    {profilesModified}
                    usersInRoom={usersInViewedRoom}
                    roomID={viewedRoomID}
                    serverID={viewedServerID}
                    currentUserID={viewedServerUserID}
                    messageTimeFormat={mainStore.miscConfig.messageTimeFormat}
                    room={viewedRoom} />
            {/if}
        </div>
        <div class="right-panel panel-glass panel-border">
            <RightPanel
                serverID={viewedServerID}
                {profilesModified}
                participants={participantsInViewedRoom}
                {lastActivityCheck} />
        </div>
    </div>
{/if}
