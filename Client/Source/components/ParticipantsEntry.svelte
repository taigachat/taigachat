<script lang="ts">
import Icon from "./Icon.svelte";
import { setPopup } from "../routes";
import { getServerProfile } from "../profiles";
import { micOff, volumeOff } from "../icons";
import type { Immutable } from "../immutable";
import type { ServerUser } from "../schema";

interface ParticipantsEntryProps {
    serverID: string;
    userID: string;
    profilesModified: number;
    user: Immutable<ServerUser> | undefined;
    lastActivityCheck?: number;
    selfMute?: boolean;
    selfDeafen?: boolean;
    talking?: boolean;
}

// This new prop system is absolutely hideous with TS types.
// Thanks Harris!
let {
    serverID,
    userID,
    profilesModified,
    user,
    lastActivityCheck = 0,
    selfMute = false,
    selfDeafen = false,
    talking = false,
}: ParticipantsEntryProps = $props();

// TODO: The threshold should be more intelligent
const isActive = $derived(user && lastActivityCheck - user.lastSeen < 10 * 60);
const isConnected = $derived(user && user.connected > 0);

const confirmedProfile = $derived(getServerProfile(serverID, userID, user, profilesModified));
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
    font-variation-settings: "wght" 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
}
.participant-muted,
.participant-deaf {
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

<button class="participants-entry" onclick={() => setPopup({ viewUser: { userID, serverID } })}>
    {#key profilesModified}
        <div class="avatar-container">
            <img
                class="participant-avatar"
                loading="lazy"
                alt="avatar of {confirmedProfile.displayedName}"
                src={confirmedProfile.displayedAvatar}
                onload={confirmedProfile.load} />
            {#if isConnected}
                {#if isActive}
                    <div class="activity-indicator activity-online"></div>
                {:else}
                    <div class="activity-indicator activity-away"></div>
                {/if}
            {:else if user}
                <div class="activity-indicator activity-offline"></div>
            {/if}
        </div>
        <div class="participant-name">
            {confirmedProfile.displayedName}
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
    {/key}
</button>
