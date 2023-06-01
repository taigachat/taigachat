<!-- TODO: Maybe rename to ProfileCard? -->
<script lang="ts">

import RoleAssignmentsEditor from './RoleAssignmentsEditor.svelte'
import { setAudioLevel } from '../store'
import type { Immutable } from '../immutable'
import type { AudioLevels } from  '../voice_config'
import type { Popup, Server } from '../store'
import type { ServerUser } from '../schema'
import { profileLoad, profileLoader } from '../profiles'
import { EMPTY_URL } from '../join_url'
export let viewedServer: Immutable<Server> | undefined
export let popup: Immutable<Popup>
export let audioLevels: Immutable<AudioLevels>
export let user: Immutable<ServerUser>|undefined

$: volume = audioLevels[popup.viewUserID || '']
$: nonUndefinedVolume = volume !== undefined ? volume : 100
$: profileTimestamp = user && user.profileTimestamp || 0


function volumeAdjusted() {
    setAudioLevel(popup.viewUserID || '', nonUndefinedVolume)
}

let nameTag: string
function setNameTag(tag: string) {
    nameTag = tag
}
</script>

<style>
.user-card-top {
    display: flex;
    margin-bottom: 10px;
}
.user-card-avatar {
    width: 100px;
    height: 100px;
    margin-right: 10px;
}
.user-card-name {
    font-size: 1.3em;
}
</style>

{#if popup.viewUserID}
    <div>
        <label>
            Volume:
            <input bind:value={nonUndefinedVolume} on:change={volumeAdjusted} type="range" min="0" max="100" on:change={volumeAdjusted} />
        </label>
    </div>
    <div class="user-card-top">
        <img alt="avatar for {nameTag}"
             class="user-card-avatar"
             loading="lazy"
             use:profileLoader={profileLoad(setNameTag,
                                            popup.viewUserID,
                                            profileTimestamp,
                                            EMPTY_URL)} />
        <div class="user-card-name">{nameTag}</div>
    </div>
    <label>
        ID: <input value={popup.viewUserID} readonly={true} />
    </label>
    {#if user !== undefined}
        <div>
            Last seen: <input readonly value={new Date(user.lastSeen * 1000).toString()} />
        </div>
    {/if}
    {#if viewedServer}
        <RoleAssignmentsEditor userID={popup.viewUserID} server={viewedServer} />
    {/if}
{/if}
