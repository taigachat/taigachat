<script lang="ts">
import { setChangelogIndex, setPopup } from '../store'
import { onDestroy } from 'svelte'

export let changelog: string[]
export let changelogIndex: number
export let showChangelog: boolean|undefined

function dismiss() {
    console.log('changelog dismissed')
    setChangelogIndex(changelog.length)
    setPopup({})
}

$: if (showChangelog) {
    onDestroy(dismiss)
}
</script>

<style>
.changelog {
    padding: 6px;
    margin: 8px;
    border-radius: 3px;
    max-height: 200px;
    overflow-y: scroll;
    overflow-x: auto;
}
.changelog div {
    margin: 3px;
}
</style>

{#if showChangelog}
    The following changes have been made:
    <div class="changelog panel-glass">
        {#each changelog.slice(0, changelog.length - changelogIndex) as change}
            <div>{change}</div>
        {/each}
    </div>

    <button on:click={dismiss} class="big-button blue">Ok</button>
{/if}
