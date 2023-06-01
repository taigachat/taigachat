<script lang="ts">
import Icon from './Icon.svelte'
import { setPopup } from '../store'
import { profileLoader, profileLoad } from '../profiles'
import { micOff, volumeOff } from '../icons'
import type { Immutable } from '../immutable'
import type { ServerUser } from '../schema'

export let userID: string
export let profilesURL: (fileName: string) => URL
export let user: Immutable<ServerUser>|undefined
export let lastActivityCheck = 0
export let selfMute = false
export let selfDeafen = false
export let talking = false

// TODO: The threshold should be more intelligent
$: isActive = user && lastActivityCheck - user.lastSeen < (10 * 60)
$: isConnected = user && user.connected > 0
$: profileTimestamp = user && user.profileTimestamp || 0


let nameTag: string

function setNameTag(n: string) {
    nameTag = n
}
</script>

<style>
.participant-avatar {
    border-radius: 50%;
    height: 30px;
    width: 30px;
    vertical-align: middle;
}
.participants-entry {
    padding: 5px;
    border-radius: 3px;
    margin: 4px;
    font-variation-settings: 'wght' 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
}
.participant-muted, .participant-deaf {
    fill: var(--white1);
    display: inline-flex;
    vertical-align: middle;
}
.participants-entry:hover {
    background-color: var(--background-opacity);
}
.avatar-container {
    position: relative;
}

.activity-indicator {
    position: absolute;
    bottom: -2px;
    right: -2px;

    width: 10px;
    height: 10px;
    border-radius: 50%;
}
.activity-online {
    background-color: var(--green1);
}
.activity-away {
    background-color: var(--yellow1);
}
.activity-offline {
    background-color: var(--background-opacity);
}

.participant-name {
    margin: 5px;
}
</style>

<div class="participants-entry" on:click={() => setPopup({ viewUserID: userID })}>
    <div class="avatar-container">
        <img alt="avatar for {nameTag}"
             class="participant-avatar"
             loading="lazy"
             use:profileLoader={profileLoad(setNameTag,
                                            userID,
                                            profileTimestamp,
                                            profilesURL)}
             />
        {#if isConnected}
            {#if isActive}
                <div class="activity-indicator activity-online" />
            {:else}
                <div class="activity-indicator activity-away" />
            {/if}
        {:else if user}
            <div class="activity-indicator activity-offline" />
        {/if}
    </div>
    <div class="participant-name">
        {nameTag}
    </div>
    {#if selfMute}
        <span class="participant-muted">
            <Icon icon={micOff} size="18" />
        </span>
    {/if}
    {#if selfDeafen}
        <span class="participant-deaf">
            <Icon icon={volumeOff} size="18" />
        </span>
    {/if}
    {#if talking}
        talking...
    {/if}
</div>
