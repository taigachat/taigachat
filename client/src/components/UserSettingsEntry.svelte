<script lang="ts">
import type { Immutable } from '../immutable'
import { setClientUserCentralUsername, deleteClientUser } from '../store'
import type { ClientUser } from '../store'
import { setPopup } from '../store'
import { fileSelect } from '../svelte_actions'
import { profileWatcher, getProfile, insertProfile, profileLoad, profileLoader } from '../profiles'
import { importKeyJWK } from '../user_chains'
import { PemConverter } from '@peculiar/x509'
import { EMPTY_URL } from '../join_url'

let showAdvancedSettings = false
let feedbackText = ''

$: userID = clientUser.userID
$: watcher = profileWatcher(userID)
$: latestProfileTimestamp = $watcher
$: latestProfile = getProfile(EMPTY_URL, userID, latestProfileTimestamp)

export let clientUser: Immutable<ClientUser>

let newProfileName: string

async function nameKeyPressHandler(e: KeyboardEvent) {
    if (e.key === 'Enter') {
        try {
            const profile = await latestProfile
            await insertProfile(userID, {
                ...profile.profileData,
                timestamp: Math.floor(Date.now() / 1000),
                userName: newProfileName,
            }, await importKeyJWK(clientUser.key, 'sign'), PemConverter.decodeFirst(clientUser.chain), profile.arrayBuffer)
            feedbackText = 'Profile name changed!'
        } catch (e) {
            feedbackText = `${e}`
        }
    }
}

async function changeAvatar(file: File) {
    // TODO: Make sure file.type is png or apng
    try {
        const profile = await latestProfile
        const arrayBuffer = await file.arrayBuffer()
        await insertProfile(userID, {
            ...profile.profileData,
            timestamp: Math.floor(Date.now() / 1000),
            userName: newProfileName,
        }, await importKeyJWK(clientUser.key, 'sign'), PemConverter.decodeFirst(clientUser.chain), arrayBuffer)
        feedbackText = 'Avatar changed!'
    } catch (e) {
        console.error(e)
        feedbackText = `${e}`
    }
}

function setNameTag(name: string) {
    newProfileName = name
}

</script>

<style>
.toggle-switch {
    margin-left: 4px;
}
.user-profile {
    padding: 12px;
    margin: 10px;
    border-radius: 12px;
}

.user-profile-top {
    display: flex;
    padding-bottom: 10px;
    min-height: 85px;
}
.user-profile-id {
    padding-bottom: 10px;
}
.user-profile img {
    width: 70px;
    height: 70px;
    padding-right: 10px;
    pointer-events: all;
}
.user-profile-name {
    padding: 5px;
}
.central-server-settings {
    margin-bottom: 12px;
}
.user-feedback-text {
    color: var(--green1);
}
.user-change-avatar-text {
    pointer-events: all;
}
</style>

<div class="user-profile panel-glass">
    <div class="user-profile-top">
        <img alt="click her to change user avatar"
             loading="lazy"
             use:profileLoader={profileLoad(setNameTag,
                                            userID,
                                            latestProfileTimestamp,
                                            EMPTY_URL)}
             use:fileSelect={changeAvatar}
             />
        <div>
            <div class="user-profile-id">
                <label>
                    ID:
                    <input readonly value={userID} />
                </label>
            </div>
            <!-- TODO: It is not obvious that the ID can not be changed while name is the thing that you change, fix this! -->
            <input
                class="user-profile-name panel-glass"
                on:keypress={nameKeyPressHandler}
                placeholder="Display name"
                bind:value={newProfileName} />
            <br />
            {#if showAdvancedSettings}
                Profile version: {latestProfileTimestamp}
            {/if}
        </div>
    </div>
    {#if feedbackText}
        <div class="user-feedback-text">
            {feedbackText}
        </div>
    {:else}
        <div class="user-change-avatar-text" use:fileSelect={changeAvatar}>
            Click to change avatar
        </div>
    {/if}
    <div>
        {#if clientUser.centralUsername !== undefined}
            <button on:click={() => setPopup({inviter: userID})} class="big-button green">Invite friends</button>
        {/if}
        {#if showAdvancedSettings}
            <button on:click={() => setPopup({authenticator: userID})} class="big-button blue">
                Offline Authenticator
            </button>
        {/if}
        <button class="big-button red" on:click={() => deleteClientUser(userID)}>Logout</button>
    </div>
    <div class="central-server-settings">
        {#if clientUser.centralUsername === undefined}
            <button on:click={() => setPopup({connectWithCentral: userID})} class="big-button blue">Connect with Central</button>
        {:else}
            <div>
                Central username: {clientUser.centralUsername}
            </div>
            {#if showAdvancedSettings}
                <button on:click={() => setClientUserCentralUsername(userID, undefined)} class="big-button red">Disconnect from Central</button>
            {/if}
        {/if}
    </div>
    <div>
        Show advanced settings
        <div
            class="toggle-switch"
            class:toggled={showAdvancedSettings}
            on:click={() => (showAdvancedSettings = !showAdvancedSettings)}>
            <div />
        </div>
    </div>
</div>
