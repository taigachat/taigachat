<script lang="ts">
import type { NavigationStatus, Page } from "../routes";
import type { MainStore } from "../store";
import type { Immutable } from "../immutable";

const SPEED = "175ms";
const ANIMATE_NAME_IN = "animation-fade-in";
const ANIMATE_NAME_OUT = "animation-fade-out";
const ANIMATE_IN = `${ANIMATE_NAME_IN} ${SPEED} ease-in`;
const ANIMATE_OUT = `${ANIMATE_NAME_OUT} ${SPEED} ease-in`;

export let mainStore: Immutable<MainStore>;
export let page: Page;
export let navigationStatus: NavigationStatus;

// TODO: Keep old version of mainStore while phasing out then discard.
// TODO: Or is this overkill?

$: shown = page.name === navigationStatus.page.name;

let needsRender = false;
$: if (shown && !needsRender) {
    needsRender = true;
}

function transitionEndHandler(event: AnimationEvent) {
    if (event.target instanceof HTMLDivElement) {
        if (event.animationName === ANIMATE_NAME_OUT) {
            needsRender = false;
        }
    }
}
</script>

<!--page {page.name} {navigationStatus.page.name}-->
<div
    on:animationend={transitionEndHandler}
    class="animate-fade click-disabled"
    class:click-enabled={shown}
    style:animation={shown ? ANIMATE_IN : ANIMATE_OUT}>
    {#if needsRender}
        <slot {mainStore} />
    {/if}
</div>
