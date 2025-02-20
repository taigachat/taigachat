<script lang="ts">
import ParticipantsEntry from "./ParticipantsEntry.svelte";
import type { Immutable } from "../immutable";
import { navigateTo } from "../routes";
import type { RankCategory } from "../store";

import Icon from "./Icon.svelte";
import { group, search, inbox, settings } from "../icons";

export let serverID: string;
export let participants: Immutable<RankCategory[]>;
export let profilesModified: number;
export let lastActivityCheck: number;

let mode = 0;
</script>

<style>
.right-panel {
    padding: 5px 0 0 10px;
    font-size: 0.9em;
}
.right-panel-actions {
    padding: 10px;
    display: flex;
    justify-content: space-around;
    font-size: 1.2em;
    max-height: 55px;
    fill: var(--icon-color);
}
.right-panel-actions button:hover,
.right-panel-actions button.selected {
    fill: var(--icon-color-hover);
}
</style>

<div class="right-panel-actions">
    <button class:selected={mode == 0} on:click={() => (mode = 0)}><Icon icon={group} size="24" /></button>
    <button class:selected={mode == 1} on:click={() => (mode = 1)}><Icon icon={search} size="24" /></button>
    <button class:selected={mode == 2} on:click={() => (mode = 2)}><Icon icon={inbox} size="24" /></button>
    <button on:click={() => navigateTo({ name: "settings", serverID, category: "" })}>
        <Icon icon={settings} size="24" />
    </button>
</div>
<div class="right-panel">
    {#if mode == 0 && participants !== undefined}
        {#each participants as role}
            {#if role.users.length > 0}
                <div class="participants-role">
                    {role.name} - {role.users.length}
                </div>
                {#each role.users as user (user.userID)}
                    <ParticipantsEntry
                        {serverID}
                        userID={user.userID}
                        {user}
                        {lastActivityCheck}
                        {profilesModified} />
                {/each}
            {/if}
        {/each}
    {:else if mode == 1}
        Search: ...
    {:else if mode == 2}
        Latest messages...
    {/if}
</div>
