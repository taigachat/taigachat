<script lang="ts">
import type { Immutable } from "../immutable";
import { setClientUserCentralUsername, deleteClientUser } from "../store";
//import { ImageEmbeddedProfile } from '../schema'
import type { ClientUser } from "../store";
import { setPopup } from "../routes";
import { fileSelect } from "../svelte_actions";
import { getLocalProfile, insertLocalProfile } from "../profiles";

let showAdvancedSettings = false;
let feedbackText = "";
let latestProfileTimestamp = 0;

$: localID = clientUser.localID;

export let clientUser: Immutable<ClientUser>;
export let localProfilesModified: number;

let newProfileName: string = getLocalProfile(clientUser.localID).profileData.userName;

async function nameKeyPressHandler(e: KeyboardEvent) {
    if (e.key !== "Enter") {
        return;
    }

    if (!("ecdsaIdentity" in clientUser.mainIdentifier)) {
        feedbackText = "only ecdsa based accounts may change their profile";
        return;
    }

    try {
        const profile = getLocalProfile(localID);
        await insertLocalProfile(
            localID,
            {
                ...profile.profileData,
                timestamp: Math.floor(Date.now() / 1000),
                userName: newProfileName,
            },
            clientUser.mainIdentifier,
            profile.arrayBuffer
        );
        feedbackText = "Profile name changed!";
    } catch (e) {
        feedbackText = `${e}`;
    }
}

async function changeAvatar(file: File) {
    if (!("ecdsaIdentity" in clientUser.mainIdentifier)) {
        feedbackText = "only ecdsa based accounts may change their profile";
        return;
    }

    // TODO: Make sure file.type is png or apng
    try {
        const profile = getLocalProfile(localID);
        const arrayBuffer = await file.arrayBuffer();
        await insertLocalProfile(
            localID,
            {
                ...profile.profileData,
                timestamp: Math.floor(Date.now() / 1000),
                userName: newProfileName,
            },
            clientUser.mainIdentifier,
            arrayBuffer
        );
        feedbackText = "Avatar changed!";
    } catch (e) {
        console.error(e);
        feedbackText = `${e}`;
    }
}

$: confirmedProfile = getLocalProfile(localID, localProfilesModified);
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
        {#key localProfilesModified}
            <img
                loading="lazy"
                alt="click here to change user avatar"
                src={confirmedProfile.displayedAvatar}
                on:load={confirmedProfile.load}
                use:fileSelect={changeAvatar} />
            <div>
                <div class="user-profile-id">
                    <label>
                        Local ID:
                        <input readonly value={localID} />
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
        {/key}
    </div>
    {#if feedbackText}
        <div class="user-feedback-text">
            {feedbackText}
        </div>
    {:else}
        <div class="user-change-avatar-text" use:fileSelect={changeAvatar}>Click to change avatar</div>
    {/if}
    <div>
        {#if clientUser.centralUsername !== undefined}
            <button on:click={() => setPopup({ inviter: localID })} class="big-button green"
                >Invite friends</button>
        {/if}
        {#if showAdvancedSettings}
            <button on:click={() => setPopup({ authenticator: localID })} class="big-button blue">
                Offline Authenticator
            </button>
        {/if}
        <button class="big-button red" on:click={() => deleteClientUser(localID)}>Logout</button>
    </div>
    <div class="central-server-settings">
        {#if clientUser.centralUsername === undefined}
            <button on:click={() => setPopup({ connectWithCentral: localID })} class="big-button blue"
                >Connect with Central</button>
        {:else}
            <div>
                Central username: {clientUser.centralUsername}
            </div>
            {#if showAdvancedSettings}
                <button
                    on:click={() => setClientUserCentralUsername(localID, undefined)}
                    class="big-button red">Disconnect from Central</button>
            {/if}
        {/if}
    </div>
    <div>
        <!-- TODO: Replace with a link to "More options" -->
        Show advanced settings
        <button
            aria-label="toggle advanced user settings"
            class="toggle-switch"
            class:toggled={showAdvancedSettings}
            on:click={() => (showAdvancedSettings = !showAdvancedSettings)}>
            <div></div>
        </button>
    </div>
</div>
