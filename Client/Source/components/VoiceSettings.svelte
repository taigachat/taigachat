<script lang="ts">
import type { Immutable } from "../immutable";
import type { VoiceConfig } from "../voice_config";
import { togglePushToTalk, toggleNoiseSuppression, toggleSelfDeafen, toggleSelfMute } from "../store";
import type { MiscConfig } from "../store";
import { setVoiceInputAudioDevice } from "../acts";
import ShortcutSetter from "./ShortcutSetter.svelte";

export let voice: Immutable<VoiceConfig>;
export let miscConfig: Immutable<MiscConfig>;

let inputAudioDevices: MediaDeviceInfo[] = [];

async function setDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    inputAudioDevices = devices.filter((d) => d.kind === "audioinput");
}

$: {
    setDevices();
}

$: inputDeviceID = voice.inputAudioDevice && voice.inputAudioDevice.deviceId;
</script>

<style>
.voice-settings {
    padding: 12px;
}
.settings-text {
    display: inline-block;
    margin: 4px;
    width: 150px;
}
.settings-text-big {
    margin: 12px 0px 12px 0px;
    display: inline-block;
    font-size: 1.2em;
}
.device-entry {
    display: flex;
    flex-flow: row nowrap;
}
.device-entry > div {
    min-width: 300px;
    max-width: 300px;
}
</style>

<div class="voice-settings">
    <div>
        <span class="settings-text"> Push to Talk </span>
        <button
            aria-label="toggle push to talk"
            class="toggle-switch"
            class:toggled={miscConfig.pushToTalk}
            on:click={togglePushToTalk}>
            <div></div>
        </button>
        <ShortcutSetter keyBindings={miscConfig.keyBindings} keyBindingName="pushToTalk" global={true} />
    </div>
    <div>
        <span class="settings-text"> Noise Suppression </span>
        <button
            aria-label="toggle noise suppresson"
            class="toggle-switch"
            class:toggled={voice.noiseSuppression}
            on:click={toggleNoiseSuppression}>
            <div></div>
        </button>
    </div>
    <div>
        <span class="settings-text"> Muted </span>
        <button
            aria-label="toggle mute"
            class="toggle-switch"
            class:toggled={voice.selfMute}
            on:click={toggleSelfMute}>
            <div></div>
        </button>
    </div>
    <div>
        <span class="settings-text"> Deafened </span>
        <button
            aria-label="toggle deafen"
            class="toggle-switch"
            class:toggled={voice.selfDeafen}
            on:click={toggleSelfDeafen}>
            <div></div>
        </button>
    </div>
    <div>
        <span class="settings-text-big"> Input Device </span>
        <div>
            {#each inputAudioDevices as device}
                <div class="device-entry">
                    <div>
                        {device.label}
                    </div>
                    {#if device.deviceId === inputDeviceID}
                        <button class="big-button blue disabled"> Current </button>
                    {:else}
                        <button class="big-button green" on:click={() => setVoiceInputAudioDevice(device)}>
                            Select
                        </button>
                    {/if}
                </div>
            {/each}
            <div class="device-entry">
                <div>Default</div>
                {#if undefined === inputDeviceID}
                    <button class="big-button blue disabled"> Current </button>
                {:else}
                    <button class="big-button green" on:click={() => setVoiceInputAudioDevice(undefined)}>
                        Select
                    </button>
                {/if}
            </div>
        </div>
    </div>
</div>
