<script lang="ts">
import Credits from './Credits.svelte'
import UserSettings from './UserSettings.svelte'
import ServerSettings from './ServerSettings.svelte'
import VoiceSettings from './VoiceSettings.svelte'
import Icon from './Icon.svelte'
import { mainStore, toggleCentralAutoUpdate, setMiscConfig } from '../store'
import { navigateUp } from '../acts'
import { appVersion } from '../options'
import { back } from '../icons'

$: categories = ['Misc', 'User', 'Voice', 'Credits', $mainStore.viewedServerID !== -1 ? 'Server' : undefined]

let selectedCategory = 'User'

$: if ($mainStore.viewedServerID === -1 && selectedCategory === 'Server') selectedCategory = 'User'

$: clientUsers = $mainStore.clientUsers

$: server = $mainStore.servers[$mainStore.viewedServerID]

$: voice = $mainStore.voice

$: layout = $mainStore.layout

$: miscConfig = $mainStore.miscConfig

let advancedMiscSettings = false

function androidAppDebug(state: boolean) {
    return () => {
        if ('androidApp' in window) {
            (window as any).androidApp.setDebug(state)
        }
    }
}

let messageTimeFormat: HTMLInputElement

function setMessageTimeFormat() {
    setMiscConfig({
        ...miscConfig,
        messageTimeFormat: messageTimeFormat.value
    })
}

function produceAudioTest() {
    (window as any).debugProduceMedia(2)
}

</script>

<style>
.settings-categories {
    display: flex;
    flex-flow: column nowrap;
}
.settings-category,.settings-title {
    font-size: 0.9em;
    padding: 10px 20px;
}

.settings-category:hover,
.settings-category.selected {
    background-color: var(--background-opacity);
}

.settings-title {
    width: 100%;
    line-height: 32px;
    display: flex;
    flex-flow: nowrap row;
    text-align: center;
    position: relative;
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
.settings-back-mobile {
    position: absolute;
    top: 8px;
    right: 8px;
    fill: var(--background-opacity);
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
    <div class="settings-back-big" on:click={navigateUp}/>
    <div class="settings-back" on:click={navigateUp}>
        <Icon icon={back} size="32" />
    </div>
{:else}
    <div class="settings-title">
        Settings
        <span class="settings-back-mobile" on:click={navigateUp}>
            <Icon icon={back} size="32" />
        </span>
    </div>
{/if}
<div class="settings-content" class:mobile-overflow={layout.mobile}>
    <div class="settings-categories panel-glass panel-border">
        {#each categories as category}
            {#if category}
                <div
                    class="settings-category"
                    class:selected={selectedCategory == category}
                    on:click={() => (selectedCategory = category)}>
                    {category}
                </div>
            {/if}
        {/each}
    </div>
    <div class="settings-current panel-glass panel-border">
        {#if selectedCategory == 'User'}
            <div class="settings-padded">
                <UserSettings />
            </div>
        {:else if selectedCategory === 'Credits'}
            <div class="settings-padded">
                <Credits />
            </div>
        {:else if selectedCategory === 'Server'}
            {#if server !== undefined}
                <ServerSettings mobileLayout={layout.mobile} {clientUsers} {server} serverID={$mainStore.viewedServerID} />
            {/if}
        {:else if selectedCategory === 'Voice'}
            <VoiceSettings {miscConfig} {voice} />
        {:else if selectedCategory === 'Misc'}
            <div class="settings-padded">
                <div>
                    Auto-update
                    <div
                        class="toggle-switch"
                        class:toggled={miscConfig.autoUpdate}
                        on:click={toggleCentralAutoUpdate}>
                        <div />
                    </div> 
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
                    Advanced Settings
                    <div
                        class="toggle-switch"
                        class:toggled={advancedMiscSettings}
                        on:click={() => advancedMiscSettings = !advancedMiscSettings}>
                        <div />
                    </div> 
                </div>
                {#if advancedMiscSettings}
                    {#if 'androidApp' in window}
                        <div>
                            Android App Debugging
                            <button on:click={androidAppDebug(false)} class="big-button green">Disable</button>
                            <button on:click={androidAppDebug(true)} class="big-button red">Enable</button>
                        </div>
                    {/if}
                    <button class="big-button red" on:click={produceAudioTest}>
                        Produce Audio
                    </button>
                {/if}
            </div>
        {/if}
    </div>
</div>
