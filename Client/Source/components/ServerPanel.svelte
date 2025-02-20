<script lang="ts">
import { setActiveVoiceChannel, setServerConnectivityInfo } from "../store";
import { navigateTo } from "../routes";
import type { Immutable } from "../immutable";
import type { ListedServer, Server } from "../store";
import ParticipantEntry from "./ParticipantsEntry.svelte";
import VoiceControls from "./VoiceControls.svelte";
import Icon from "./Icon.svelte";
import { channel as channelIcon } from "../icons";
import type { ServerUser } from "../schema";
import type { VoiceConfig } from "../voice_config";

export let server: Immutable<Server>;
export let connectivityInfo: Immutable<ListedServer>;
export let profilesModified: number;
export let users: Immutable<Record<string, ServerUser>>;
export let voice: Immutable<VoiceConfig>;
export let activeVoiceServer: Immutable<Server> | undefined;

$: shownRooms = Object.entries(server.rooms).filter(([_, r]) => !r.hidden);

function joinChannel(channelID: number) {
    return async () => {
        await setActiveVoiceChannel(server.serverID, channelID);
    };
}

function enableServer() {
    setServerConnectivityInfo(server.serverID, {
        ...connectivityInfo,
        enabled: true,
    });
}

// TODO: Perhaps one day we can write proper text layout code...
function shortenServerName(name: string) {
    return name.length > 50 ? name.substring(0, 50) + "..." : name;
}
</script>

<style>
.server-info {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    margin-left: 0;
    padding: 0 5px;
    flex-flow: nowrap column;
}
.server-room-list {
    display: flex;
    flex-flow: column nowrap;
    align-items: flex-start;
    flex-grow: 1;
}
.server-name {
    width: 100%;
    padding: 15px;
    font-size: 1.2em;
    max-height: 90px;
    overflow: hidden;
}
.list-entry {
    font-size: 1.1em;
    padding: 6px 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    fill: var(--white1);
    width: 100%;
    display: flex;
    align-items: center;
}
.list-entry:hover,
.list-entry.selected {
    background-color: var(--background-opacity);
}
.list-entry span {
    padding-left: 5px;
}

.enable-server {
    padding: 8px;
    border-bottom: 2px solid var(--background-opacity);
}

.new-message-indicator {
    background-color: var(--red1);
    display: inline-block;
    height: 10px;
    width: 10px;
    border-radius: 50%;
}
</style>

<div class="server-info panel-glass panel-border">
    {#if !connectivityInfo.enabled}
        <div class="enable-server">
            Server has been paused
            <br />
            <button class="big-button green" on:click={enableServer}>Enable server</button>
        </div>
    {/if}
    <div class="server-name magic-top-height">
        {shortenServerName(server.serverInfo.name)}
    </div>
    <div class="server-room-list">
        {#each shownRooms as [roomID, room]}
            <button
                on:click={() =>
                    navigateTo({ name: "main", serverID: server.serverID, roomID: parseInt(roomID) })}
                class:selected={server.viewedRoomID === parseInt(roomID)}
                class="list-entry">
                #
                <span>
                    {room && room.name}
                    {#if room && room.lastNextMessageID !== room.nextMessageID}
                        <div class="new-message-indicator"></div>
                    {/if}
                </span>
            </button>
        {/each}
        {#each server.channels as channel}
            <button class="list-entry" on:click={joinChannel(channel.channelID)}>
                <Icon size="18" icon={channelIcon} /> <span>{channel.name}</span>
            </button>
            {@const activeChannel = server.activeChannels[channel.channelID]}
            {#if activeChannel && activeChannel.connectedUsers.length > 0}
                <div>
                    {#each activeChannel.connectedUsers as user}
                        <ParticipantEntry
                            serverID={server.serverID}
                            {profilesModified}
                            userID={user.userID}
                            user={users[user.userID]}
                            selfMute={user.selfMute}
                            selfDeafen={user.selfDeafen}
                            talking={user.talking} />
                    {/each}
                </div>
            {/if}
        {/each}
    </div>
    <div>
        {#if activeVoiceServer !== undefined}
            {#if voice.activeChannelID !== -1}
                <VoiceControls
                    {voice}
                    channelName={activeVoiceServer.channels[voice.activeChannelID]?.name || "Unknown name"} />
            {/if}
        {/if}
    </div>
</div>
