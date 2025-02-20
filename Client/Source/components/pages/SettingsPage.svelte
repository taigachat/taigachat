<script lang="ts">
import Credits from "../Credits.svelte";
import UserSettings from "../UserSettings.svelte";
import ServerSettings from "../ServerSettings.svelte";
import VoiceSettings from "../VoiceSettings.svelte";
import Icon from "../Icon.svelte";
import type { Immutable } from "../../immutable";
import { toggleCentralAutoUpdate, setMiscConfig, toggleMobileUI } from "../../store";
import type { MainStore } from "../../store";
import { appVersion } from "../../options";
import { back } from "../../icons";
import { navigateTo, closePage, setPopup } from "../../routes";

export let mainStore: Immutable<MainStore>;
export let viewedServerID: string;
export let selectedCategory: string;
export let profilesModified: number;
export let localProfilesModified: number;

$: categories = ["Misc", "User", "Voice", "Credits", viewedServerID !== "" ? "Server" : undefined];

$: clientUsers = mainStore.clientUsers;

$: server = mainStore.servers[viewedServerID];

$: viewedServerConnectivityInfo = mainStore.listedServers[viewedServerID];

$: voice = mainStore.voice;

$: layout = mainStore.layout;

$: miscConfig = mainStore.miscConfig;

let advancedMiscSettings = false;

function androidAppDebug(state: boolean) {
    return () => {
        if ("androidApp" in window) {
            (window as { androidApp: { setDebug: (b: boolean) => void } }).androidApp.setDebug(state);
        }
    };
}

let messageTimeFormat: HTMLInputElement;

function setMessageTimeFormat() {
    setMiscConfig({
        ...miscConfig,
        messageTimeFormat: messageTimeFormat.value,
    });
}

function produceAudioTest() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).debug.produceMedia(2);
}
</script>

<style>
.settings-categories {
    display: flex;
    flex-flow: column nowrap;
}
.settings-category {
    font-size: 0.9em;
    padding: 10px 20px;
}

.settings-category:hover,
.settings-category.selected {
    background-color: var(--background-opacity);
}

.settings-back {
    fill: var(--icon-color);
}
.settings-back:hover {
    fill: var(--icon-color-hover);
}
.settings-current {
    flex-grow: 1;
}
.settings-padded {
    padding: 30px;
}
.settings-back-big {
    top: 0;
    right: 0;
    position: absolute;
    width: 45px;
    height: 35px;
}
.settings-content {
    display: flex;
    flex-flow: row nowrap;
    height: 100%;
}
.mobile-overflow {
    overflow-y: scroll;
    display: flex;
    flex-flow: column nowrap;
}
</style>

{#if !layout.mobile}
    <button aria-label="back to previous page" class="settings-back-big" on:click={closePage}></button>
    <button class="settings-back" on:click={closePage}>
        <!-- TODO: factor it out and display it from App.svelte instead for all non main pages. -->
        <Icon icon={back} size="32" />
    </button>
{/if}

<div class="settings-content" class:mobile-overflow={layout.mobile}>
    <div class="settings-categories panel-glass panel-border">
        {#each categories as category}
            {#if category}
                {@const categorySafe = category}
                <button
                    class="settings-category"
                    class:selected={selectedCategory == category}
                    on:click={() =>
                        navigateTo({ name: "settings", serverID: viewedServerID, category: categorySafe })}>
                    {category}
                </button>
            {/if}
        {/each}
    </div>
    <div class="settings-current panel-glass panel-border">
        {#if selectedCategory == "User"}
            <div class="settings-padded">
                <UserSettings {localProfilesModified} />
            </div>
        {:else if selectedCategory === "Credits"}
            <div class="settings-padded">
                <Credits />
            </div>
        {:else if selectedCategory === "Server"}
            {#if server !== undefined && viewedServerConnectivityInfo !== undefined}
                <ServerSettings
                    mobileLayout={layout.mobile}
                    {profilesModified}
                    {clientUsers}
                    {server}
                    serverID={viewedServerID}
                    connectivityInfo={viewedServerConnectivityInfo} />
            {/if}
        {:else if selectedCategory === "Voice"}
            <VoiceSettings {miscConfig} {voice} />
        {:else if selectedCategory === "Misc"}
            <div class="settings-padded">
                <div>
                    Auto-update
                    <button
                        aria-label="toggle central auto updating"
                        class="toggle-switch"
                        class:toggled={miscConfig.autoUpdate}
                        on:click={toggleCentralAutoUpdate}>
                        <div></div>
                    </button>
                </div>
                <div>
                    Current version: {appVersion}
                </div>
                <div>
                    Time format:
                    <input
                        class="panel-glass"
                        bind:this={messageTimeFormat}
                        value={miscConfig.messageTimeFormat}
                        on:change={setMessageTimeFormat} />
                    (somewhat follows the strftime spec)
                </div>
                <div>
                    Use mobile UI:
                    <button
                        aria-label="toggle mobile UI"
                        class="toggle-switch"
                        class:toggled={mainStore.layout.mobile}
                        on:click={toggleMobileUI}>
                        <div></div>
                    </button>
                </div>
                <div>
                    Advanced Settings
                    <button
                        aria-label="toggle advanced settings"
                        class="toggle-switch"
                        class:toggled={advancedMiscSettings}
                        on:click={() => (advancedMiscSettings = !advancedMiscSettings)}>
                        <div></div>
                    </button>
                </div>
                <div>
                    <button
                        class="big-button blue"
                        on:click={() => setPopup({ requestPermission: "notifications" })}
                        >Device Permissions</button>
                </div>
                {#if advancedMiscSettings}
                    {#if "androidApp" in window}
                        <div>
                            Android App Debugging
                            <button on:click={androidAppDebug(false)} class="big-button green"
                                >Disable</button>
                            <button on:click={androidAppDebug(true)} class="big-button red">Enable</button>
                        </div>
                    {/if}
                    <button class="big-button red" on:click={produceAudioTest}> Produce Audio </button>
                {/if}
            </div>
        {/if}
    </div>
</div>
