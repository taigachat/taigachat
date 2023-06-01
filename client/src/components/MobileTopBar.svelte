<script lang="ts">
import Icon from './Icon.svelte'
import { navigationBar, verticalMore } from '../icons'
import type { Immutable } from '../immutable'
import { setLayout, Layout } from '../store'

export let layout: Immutable<Layout>
export let title: string

function toggleLeftPanel() {
    setLayout({
        ...layout,
        rightPanel: false,
        leftPanel: !layout.leftPanel,
    })
}

function toggleRightPanel() {
    setLayout({
        ...layout,
        rightPanel: !layout.rightPanel,
        leftPanel: false,
    })
}

</script>

<style>
.mobile-top-bar {
    font-size: 1.2em;
    padding: 5px;
    width: 100%;
    /*fill: var(--very-near)*/
    fill: var(--white1);
    display: flex;
    flex-flow: row nowrap;
    justify-content: space-between;
}
</style>

<div class="panel-glass mobile-top-bar">
    <span on:click={toggleLeftPanel}>
        <Icon icon={navigationBar} size="24" />
    </span>
    {title}
    <span on:click={toggleRightPanel}>
        <Icon icon={verticalMore} size="24" />
    </span>
</div>

<!-- TODO: IN MOBILE MODE: check if in call, if so, give option to mute and leave -->
