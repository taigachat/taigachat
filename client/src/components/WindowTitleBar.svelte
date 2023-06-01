<script lang="ts">
import { sendLauncherCommand } from '../launcher_bridge'
import { isDesktop} from '../options'

function minimizeWindow() {
    sendLauncherCommand('minimize-client')
}

function maximizeWindow() {
    // One could also use:
    // window.resizeTo(screen.availWidth, screen.availHeight)
    // But that doesn't give us native behaviour (client going back to original size once
    // the user unmaximizes the window) on windows.
    sendLauncherCommand('maximize-client')
}

function closeWindow() {
    sendLauncherCommand('shutdown-client')
}
</script>
<style>
#window-title-bar {
    width: 100vw;
    height: 32px;
    user-select: none;
    -webkit-app-region: drag;
    background-color: #160c32;
    box-shadow: 0px 4px 20px 5px rgb(0 0 0 / 30%);
    font-size: 16px;
    line-height: 32px;
    -webkit-box-shadow: 0px 4px 20px 5px rgb(0 0 0 / 30%);
    z-index: 100;
    display: flex;
    justify-content: space-between;
}
.window-name-bold {
    font-variation-settings: var(--bold-text);
    margin-right: -1.5px;
}
.window-title {
    text-align: center;
}
.window-left {
    width: 50px;
    padding-left: 20px;
}
.window-controls {
    padding-right: 20px;
    font-variation-settings: var(--bold-text);
    width: 50px;
}
.window-control-button {
    user-select: contain;
    pointer-events: all;
    -webkit-app-region: none;
}
</style>

{#if isDesktop}
    <div id="window-title-bar" class="panel-glass">
        <span class="window-left">
        </span>
        <span class="window-title">
            <span class="window-name-bold">
                Taiga
            </span>
            <span class="window-name-thin">
                Chat
            </span>
        </span>
        <span class="window-controls">
            <span class="window-control-button" on:click={minimizeWindow}>_</span>
            <span class="window-control-button" on:click={maximizeWindow}>#</span>
            <span class="window-control-button" on:click={closeWindow}>X</span>
        </span>
    </div>
{/if}
