<script lang="ts">
import { sendLauncherCommand } from "../launcher_bridge";

function minimizeWindow() {
    sendLauncherCommand("minimizeClient0");
}

function maximizeWindow() {
    // One could also use:
    // window.resizeTo(screen.availWidth, screen.availHeight)
    // But that doesn't give us native behaviour (client going back to original size once
    // the user unmaximizes the window) on windows.
    sendLauncherCommand("maximizeClient0");
}

function closeWindow() {
    sendLauncherCommand("shutdownClient0");
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
    z-index: 300;
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
    font-variation-settings: var(--bold-text);
    display: flex;
    align-items: center;
}
.window-control-button {
    padding: 4px 6px;
    user-select: contain;
    pointer-events: all;
    -webkit-app-region: none;
}
.window-control-button:hover {
    background-color: #33333355;
}
</style>

<div id="window-title-bar" class="panel-glass">
    <span class="window-left"> </span>
    <span class="window-title">
        <span class="window-name-bold"> Taiga </span>
        <span class="window-name-thin"> Chat </span>
    </span>
    <span class="window-controls">
        <button class="window-control-button" tabindex="-1" on:click={minimizeWindow}>_</button>
        <button class="window-control-button" tabindex="-1" on:click={maximizeWindow}>#</button>
        <button class="window-control-button" tabindex="-1" on:click={closeWindow}>X</button>
    </span>
</div>
