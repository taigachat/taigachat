<script lang="ts">
import type { Immutable } from '../immutable'
import { setActiveVoiceChannel, toggleCamera, toggleSelfDeafen, toggleSelfMute } from '../store'
import Icon from './Icon.svelte'
import type { VoiceConfig } from '../voice_config'
import { hangup, micOn, micOff, volumeOn, volumeOff, cameraOn, cameraOff } from '../icons'

export let channelName: string
export let voice: Immutable<VoiceConfig>

async function hangupVoice() {
    await setActiveVoiceChannel(-1, -1)
}

</script>
<style>
.voice-controls {
    fill: var(--white1);
    padding: 12px;
}

.voice-control-hangup:hover {
    fill: var(--red1);
}

.voice-control-mute:hover, .voice-control-deafen:hover {
    fill: var(--blue2);
}

.connected-channel-name {
    color: var(--green1);
    padding-bottom: 8px;
}
</style>
<div class="voice-controls">
    <div class="connected-channel-name">
        Connected to {channelName}
    </div>
    <span class="voice-control-hangup" on:click={hangupVoice}>
        <Icon icon={hangup} size="24" />
    </span>
    <span class="voice-control-mute" on:click={toggleSelfMute}>
        <Icon icon={voice.selfMute ? micOff : micOn} size="24" />
    </span>
    <span class="voice-control-deafen" on:click={toggleSelfDeafen}>
        <Icon icon={voice.selfDeafen ? volumeOff : volumeOn} size="24" />
    </span>
    <span class="voice-control-camera" on:click={toggleCamera}>
        <Icon icon={voice.selfVideo ? cameraOff : cameraOn} size="24" /> 
    </span>
</div>
