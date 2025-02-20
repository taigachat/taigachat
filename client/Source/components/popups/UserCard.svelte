<!-- TODO: Maybe rename to ProfileCard? -->
<script lang="ts">
import RoleAssignmentsEditor from "../RoleAssignmentsEditor.svelte";
import { defaultServer, setAudioLevel } from "../../store";
import type { Immutable } from "../../immutable";
import type { AudioLevels } from "../../voice_config";
import type { Server } from "../../store";
import type { Popup } from "../../routes";
import { getServerProfile } from "../../profiles";
export let popup: Immutable<Popup>;
export let audioLevels: Immutable<AudioLevels>;
export let servers: Immutable<Record<string, Server>>;
export let profilesModified: number;

$: viewUserPopup =
    "viewUser" in popup
        ? popup.viewUser
        : {
              userID: "",
              serverID: "",
          };

$: server = servers[viewUserPopup.serverID] || defaultServer;
$: user = server.users[viewUserPopup.userID];
$: volume = audioLevels[viewUserPopup.userID];
$: nonUndefinedVolume = volume !== undefined ? volume : 100;

$: confirmedProfile = getServerProfile(viewUserPopup.serverID, viewUserPopup.userID, user, profilesModified);

function volumeAdjusted() {
    if ("viewUser" in popup) {
        setAudioLevel(popup.viewUser.userID || "", nonUndefinedVolume);
    }
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

{#if "viewUser" in popup}
    <div>
        <label>
            Volume:
            <input
                bind:value={nonUndefinedVolume}
                on:change={volumeAdjusted}
                type="range"
                min="0"
                max="100"
                on:change={volumeAdjusted} />
        </label>
    </div>
    {#key profilesModified}
        <div class="user-card-top">
            <img
                class="user-card-avatar"
                loading="lazy"
                alt="avatar of {confirmedProfile.displayedName}"
                src={confirmedProfile.displayedAvatar}
                on:load={confirmedProfile.load} />
            <div class="user-card-name">{confirmedProfile.displayedName}</div>
        </div>
    {/key}
    <label>
        ID: <input value={viewUserPopup.userID} readonly={true} />
    </label>
    {#if user !== undefined}
        <div>
            Last seen: <input readonly value={new Date(user.lastSeen * 1000).toString()} />
        </div>
    {/if}
    {#if server.serverID !== ""}
        <RoleAssignmentsEditor userID={viewUserPopup.userID} {server} />
    {/if}
{/if}
