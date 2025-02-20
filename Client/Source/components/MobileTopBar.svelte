<script lang="ts">
import Icon from "./Icon.svelte";
import { verticalMore, back } from "../icons";
import type { Immutable } from "../immutable";
import type { MainStore } from "../store";
import { EMPTY_POPUP, closePage, closePopup, navigateTo, pageToServerID } from "../routes";
import type { NavigationStatus } from "../routes";

export let mainStore: Immutable<MainStore>;
export let navigationStatus: NavigationStatus;

function computeTitle(mainStore: Immutable<MainStore>, navigationStatus: NavigationStatus) {
    if (navigationStatus.page.name === "settings") {
        return "Settings";
    }
    if (navigationStatus.page.name === "main") {
        const server = mainStore.servers[navigationStatus.page.serverID];
        if (!server) {
            return "Main";
        }
        const room = server.rooms[navigationStatus.page.roomID];
        if (!room) {
            return "Main";
        }
        return "#" + room.name;
    }
    if (navigationStatus.page.name === "view-server") {
        const server = mainStore.servers[navigationStatus.page.serverID];
        if (server) {
            return server.serverInfo.name;
        }
        return "Server Info";
    }
    if (navigationStatus.page.name === "mobile-overview") {
        return "Overview";
    }
    if (navigationStatus.page.name === "login") {
        return "Login";
    }

    return navigationStatus.hash;
}

$: title = computeTitle(mainStore, navigationStatus);
$: canClose =
    navigationStatus.page.name !== "main" ||
    navigationStatus.page.serverID !== "" ||
    navigationStatus.page.roomID !== -1;
$: showOverviewButton =
    navigationStatus.page.name !== "mobile-overview" && navigationStatus.page.name !== "settings";

function openOverview() {
    const serverID = pageToServerID(navigationStatus);
    navigateTo({ name: "mobile-overview", serverID, roomID: -1 });
}

function closePageOrPopup() {
    if (!canClose) {
        return;
    }
    if (navigationStatus.popup !== EMPTY_POPUP) {
        closePopup();
    } else {
        closePage();
    }
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
.button-location {
    width: 32px;
    height: 32px;
}
.top-bar-button {
    display: none;
}
.show {
    display: inline-block;
}
</style>

<div class="panel-glass mobile-top-bar">
    <button class="button-location" on:click={closePageOrPopup}>
        <span class="top-bar-button" class:show={canClose}>
            <Icon icon={back} size="32" />
        </span>
    </button>
    {title}
    <button class="button-location" on:click={openOverview}>
        <span class="top-bar-button" class:show={showOverviewButton}>
            <Icon icon={verticalMore} size="32" />
        </span>
    </button>
</div>

<!-- TODO: IN MOBILE MODE: check if in call, if so, give option to mute and leave -->
