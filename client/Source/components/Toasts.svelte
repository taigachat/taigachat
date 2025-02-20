<script lang="ts">
import { dismissToast } from "../acts";
import type { AutoUpdater, Toast } from "../store";
import type { Immutable } from "../immutable";
import { restartClient, downloadUpdate } from "../update_checker";

export let toasts: Immutable<Toast[]>;
export let isMobileDevice: boolean;
export let autoUpdater: Immutable<AutoUpdater>; // TODO: A bit unfortunate to have to take this in...
</script>

<style>
.normal-toasts-overlay {
    padding-top: 1px;
    display: flex;
    padding-right: 220px;
    align-items: flex-end;
    flex-flow: column nowrap;
}
.mobile-toasts-overlay {
    display: flex;
    flex-flow: column nowrap;
    align-items: center;
}

@keyframes border-glow-green {
    0% {
        box-shadow: var(--green1) 0 0 0px;
    }
    100% {
        box-shadow: var(--green1) 0 0 7px; /* set size to a variable or something (in all border-glow-effects) */
    }
}

@keyframes border-glow-red {
    0% {
        box-shadow: var(--red1) 0 0 0px;
    }
    100% {
        box-shadow: var(--red1) 0 0 7px;
    }
}

@keyframes border-glow-yellow {
    0% {
        box-shadow: var(--yellow1) 0 0 0px;
    }
    100% {
        box-shadow: var(--yellow1) 0 0 7px;
    }
}

.toasts-popup {
    width: 300px;
    min-height: 60px;
    padding: 10px;
    z-index: 200;
    background-color: #10101070; /* change to variable */
    display: flex;
    flex-flow: column nowrap;
    justify-content: center;
    border-width: 1.5px;
    backdrop-filter: blur(8px);
}

.toast-title {
    font-variation-settings: var(--bold-text);
    color: #dddddd;
    display: flex;
    justify-content: space-between;
    padding-bottom: 6px;
}

.toast-text {
    color: #999999ff;
}

.toast-green {
    border-color: var(--green2);
}
.toast-green:hover {
    border-color: var(--green1);
    animation: border-glow-green 100ms ease-in forwards;
}

.toast-red {
    border-color: var(--red2);
}
.toast-red:hover {
    border-color: var(--red1);
    animation: border-glow-red 100ms ease-in forwards;
}

.toast-yellow {
    border-color: var(--yellow2);
}
.toast-yellow:hover {
    border-color: var(--yellow1);
    animation: border-glow-yellow 100ms ease-in forwards;
}
</style>

<div class:mobile-toasts-overlay={isMobileDevice} class:normal-toasts-overlay={!isMobileDevice}>
    {#each toasts as toast}
        <div
            class="toasts-popup panel-border panel-glass"
            class:toast-green={toast.color === "success"}
            class:toast-red={toast.color === "error"}
            class:toast-yellow={toast.color === "warning" || toast.color === "update"}>
            <div class="toast-title">
                <div>
                    {toast.title}
                </div>
                <button class="cross-button" on:click={() => dismissToast(toast.id)}> X </button>
            </div>
            <div class="toast-text">
                {toast.text}
                {#if toast.color === "update"}
                    {#if autoUpdater.progress === 0}
                        <span>
                            A new update is available! ({autoUpdater.latestVersion})
                        </span>
                    {:else if autoUpdater.progress == 200}
                        Update downloaded!
                    {:else if autoUpdater.progress == 199}
                        <div>Unpacking the update.</div>
                        <div>Please wait...</div>
                    {:else if autoUpdater.progress == -200}
                        Could not verify signature of update!
                    {:else if autoUpdater.progress == -201}
                        Update process closed too early
                    {:else if autoUpdater.progress == -101}
                        Update server could not be reached
                    {:else if autoUpdater.progress == -100}
                        Failed to download update update! :(
                    {:else if autoUpdater.progress > 0}
                        Downloaded: {Math.floor(autoUpdater.progress * 100)}%
                    {:else}
                        Unknown update state...
                    {/if}
                    {#if autoUpdater.canDownload}
                        {#if autoUpdater.progress == 200}
                            <button class="big-button green" on:click={restartClient}>Restart</button>
                        {:else if autoUpdater.progress === 0}
                            <button class="big-button green" on:click={downloadUpdate}>Download</button>
                        {/if}
                    {/if}
                {/if}
            </div>
        </div>
    {/each}
</div>
