<script lang="ts">
import type { Immutable } from "../immutable";
import { defaultServer } from "../store";
import { setPopup, navigateTo } from "../routes";
import type { ListedServer, Server } from "../store";
import type { VoiceConfig } from "../voice_config";
import ServerIcon from "./ServerIcon.svelte";
import ServerPanel from "./ServerPanel.svelte";
import Icon from "./Icon.svelte";
import { heart, add } from "../icons";
import type { ServerUser } from "../schema";

export let listedServers: Immutable<Record<string, ListedServer>>;
export let servers: Immutable<Record<string, Server>>;
export let viewedServerID: string;
export let voice: Immutable<VoiceConfig>;
export let users: Immutable<Record<string, ServerUser>>;
export let profilesModified: number;

$: viewedServer = servers[viewedServerID];
$: viewedServerConnectivityInfo = listedServers[viewedServerID];
</script>

<style>
.server-list {
    display: flex;
    flex-shrink: 0;
    flex-flow: nowrap column;
    align-items: center;
    width: 67px;
    overflow-y: scroll;
    overflow-x: hidden;
    scrollbar-width: none;
}
.server-list::-webkit-scrollbar {
    display: none;
}

.left-panel {
    height: 100%;
    display: flex;
}

:global(.server-list-icon) {
    display: inline-block;
    background-color: var(--background-opacity);
    width: 45px;
    font-size: 45px;
    height: 45px;
    border-radius: 50%;
    margin: 2.5px;
    position: relative;
    left: 0px;
    text-align: center;
    transition: left 200ms;
}

.server-list-icon :global(svg) {
    vertical-align: baseline;
    transition: fill 200ms;
    fill: var(--white1);
}

.server-list-icon :global(svg:hover),
.server-list-icon.selected :global(svg) {
    fill: var(--pink1);
}
</style>

<div class="left-panel">
    <div class="server-list panel-border panel-glass">
        <button
            on:click={() => navigateTo({ name: "main", serverID: "", roomID: -1 })}
            class="server-list-icon"
            class:selected={viewedServerID === ""}>
            <Icon icon={heart} size="35" />
        </button>
        {#each Object.keys(listedServers) as serverID}
            <ServerIcon {viewedServerID} server={servers[serverID] || defaultServer} />
        {/each}
        <div>
            <button class="server-list-icon" on:click={() => setPopup({ addServer: true })}>
                <Icon icon={add} size="40" />
            </button>
        </div>
    </div>

    {#if viewedServer && viewedServerConnectivityInfo}
        <ServerPanel
            connectivityInfo={viewedServerConnectivityInfo}
            {profilesModified}
            {users}
            server={viewedServer}
            {voice}
            activeVoiceServer={servers[voice.activeServerID]} />
    {/if}
</div>
