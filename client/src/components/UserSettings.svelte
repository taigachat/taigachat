<script lang="ts">
import UserSettingsEntry from './UserSettingsEntry.svelte'
import { mainStore } from '../store'
import { navigate } from '../acts'

function notUndefined(o: any) {
    return o !== undefined
}

</script>

<style>
.profile-section {
    padding-top: 40px;
}
</style>

<div class="profile-section">
    {#each Object.values($mainStore.clientUsers).filter(notUndefined) as clientUser (clientUser && clientUser.userID)}
        <UserSettingsEntry {clientUser} />
    {/each}
    <button on:click={() => navigate('login')} class="big-button blue">Add User</button>
</div>
