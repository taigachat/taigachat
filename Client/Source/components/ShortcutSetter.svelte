<script lang="ts">
// TODO: Rename component to KeybindAssigner

import type { Immutable } from "../immutable";
import { setKeyBinding } from "../store";
import type { KeyBindings } from "../store";
import { hasLauncher } from "../options";
import { getNextKey } from "../keybinds";

export let keyBindingName: string;
export let keyBindings: Immutable<KeyBindings>;
export let global: boolean;

$: currentKeyBinding = keyBindings[keyBindingName];
$: currentAssignment = currentKeyBinding !== undefined ? currentKeyBinding.keyName : "Unassigned";

const AWAITING_SCAN_CODE = -1;
const SCAN_CODE_NOT_NEEDED = -2;

let newKeyName = "";
let newScanCode = AWAITING_SCAN_CODE;

let assigning = false;

function tryFinishAssign() {
    if (assigning && newKeyName !== "" && newScanCode !== AWAITING_SCAN_CODE) {
        assigning = false;
        console.log("set by scancode: ", newScanCode, newKeyName, keyBindingName);
        setKeyBinding(keyBindingName, {
            scanCode: newScanCode,
            keyName: newKeyName,
            global,
        });
    }
}

function unassignShortcut() {
    assigning = false;
    setKeyBinding(keyBindingName, undefined);
}

function startAssign() {
    assigning = true;
    newKeyName = "";
    if (hasLauncher) {
        newScanCode = AWAITING_SCAN_CODE;
        getNextKey((key) => {
            newScanCode = key;
            tryFinishAssign();
        });
    } else {
        newScanCode = SCAN_CODE_NOT_NEEDED;
    }
}

function cancelAssign() {
    assigning = false;
}

function browserKeyPressed(e: KeyboardEvent) {
    if (assigning) {
        newKeyName = e.key;
        tryFinishAssign();
    }
}
</script>

<style>
.current-key {
    width: 85px;
    display: inline-block;
}
</style>

<svelte:window on:keydown={browserKeyPressed} />

<div class="">
    <span class="panel-glass current-key">
        {#if assigning}
            Press a key
        {:else}
            {currentAssignment}
        {/if}
    </span>
    {#if assigning}
        <button class="big-button blue disabled" on:click={cancelAssign}>Cancel</button>
    {:else}
        <button class="big-button green" on:click={startAssign}>Assign</button>
    {/if}
    {#if currentKeyBinding !== undefined}
        <button class="big-button red" on:click={unassignShortcut}>Unasssign</button>
    {/if}
</div>
