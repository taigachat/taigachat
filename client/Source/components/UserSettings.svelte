<script lang="ts">
import UserSettingsEntry from "./UserSettingsEntry.svelte";
import { mainStore } from "../store";
import { navigateTo } from "../routes";

export let localProfilesModified: number;

function notUndefined<T>(o: T | undefined): o is T {
    return o !== undefined;
}
</script>

<style>
.profile-section {
    padding-top: 40px;
}
</style>

<div class="profile-section">
    {#each Object.values($mainStore.clientUsers).filter(notUndefined) as clientUser (clientUser.localID)}
        <UserSettingsEntry {clientUser} {localProfilesModified} />
    {/each}
    <button on:click={() => navigateTo({ name: "login", forced: false })} class="big-button blue"
        >Add User</button>
</div>
