<script lang="ts">
import PageDisplay from "./PageDisplay.svelte";
import PopupContent from "./PopupContent.svelte";
import Toasts from "./Toasts.svelte";
import WindowTitleBar from "./WindowTitleBar.svelte";
import MobileTopBar from "./MobileTopBar.svelte";
import MainPage from "./pages/MainPage.svelte";
import Login from "./pages/LoginPage.svelte";
import MobileOverviewPage from "./pages/MobileOverviewPage.svelte";
import Settings from "./pages/SettingsPage.svelte";
import MobileServerViewerPage from "./pages/MobileServerViewerPage.svelte";

import { isMobileDevice, mainStore } from "../store";
import { navigationStatusStore, closePopup, EMPTY_POPUP, latestPage, type Popup } from "../routes";
import { handleBrowserKeyPressed } from "../keybinds";
import { hasLauncher } from "../options";
import OfflineLoginPage from "./pages/OfflineLoginPage.svelte";
import { localProfilesModified, profilesModified } from "../profiles";

// TODO: Rename to just mainStore and rename $mainStore to something else.
$: liveMainStore = $mainStore;
$: navigationStatus = $navigationStatusStore;

let lastPopup: Popup | undefined = undefined;
function outsideClickHandler() {
    if (lastPopup === navigationStatus.popup) {
        closePopup();
    } else {
        lastPopup = navigationStatus.popup;
    }
}
function insideClickHandler() {
    lastPopup = undefined;
}

$: autoUpdater = liveMainStore.autoUpdater;
$: popup = navigationStatus.popup;
$: popupOpen = popup !== EMPTY_POPUP && navigationStatus.page.name !== "login";
$: mobileLayout = liveMainStore.layout.mobile;

$: profilesModifiedNumber = $profilesModified;
$: localProfilesModifiedNumber = $localProfilesModified;

const rememberNotFoundPage = latestPage({ name: "page-not-found" });
$: latestPageNotFound = rememberNotFoundPage(navigationStatus);

const rememberSettingsPage = latestPage({ name: "settings", category: "", serverID: "" });
$: latestSettingsPage = rememberSettingsPage(navigationStatus);

const rememberLoginPage = latestPage({ name: "login", forced: false });
$: latestLoginPage = rememberLoginPage(navigationStatus);

const rememberOfflineLoginPage = latestPage({ name: "offline-login" });
$: latestOfflineLoginPage = rememberOfflineLoginPage(navigationStatus);

const rememberMainPage = latestPage({ name: "main", serverID: "", roomID: -1 });
$: latestMainPage = rememberMainPage(navigationStatus);

const rememberViewServerPage = latestPage({ name: "view-server", serverID: "" });
$: latestViewServerPage = rememberViewServerPage(navigationStatus);

const rememberMobileOverviewPage = latestPage({ name: "mobile-overview", serverID: "", roomID: -1 });
$: latestMobileOverviewPage = rememberMobileOverviewPage(navigationStatus);

function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        closePopup();
    }
    // TODO: Perhaps settings should also be closeable this way?

    handleBrowserKeyPressed(e.key, true);
}

function handleKeyUp(e: KeyboardEvent) {
    handleBrowserKeyPressed(e.key, false);
}
</script>

<style>
.app-layout {
    display: flex;
    flex-flow: column nowrap;
    position: relative;
    flex-grow: 1;
}

.gradient-background {
    height: 100%;
    overflow: hidden;
    background: linear-gradient(90deg, #2b3a72, #420d68);
    display: flex;
    flex-flow: column nowrap;
}
.gradient-background-before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    pointer-events: none;
    mask-image: linear-gradient(to bottom, transparent, black);
    -webkit-mask-image: linear-gradient(to bottom, transparent, black);
    background: linear-gradient(90deg, #45137c, #0e1430);
}

.popup-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    background-color: #ffffff0f;
    z-index: 100; /* TODO: Create variables for z-index or remove them */
}
.popup-body {
    position: absolute;
    min-width: 300px;
    border-radius: 10px;
    border-color: var(--blue2);
    box-shadow: 1px 6px 8px 0px #00000070;
    padding: 25px;
    transform: translate(-50%, -50%);
    top: 50%;
    left: 50%;
    pointer-events: all;
    background-color: var(--background-opacity);
}
.popup-blur {
    border-radius: 10px;
    backdrop-filter: blur(8px);
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    position: absolute;
}
</style>

<svelte:window on:keydown={handleKeyDown} on:keyup={handleKeyUp} />
<svelte:body on:click={outsideClickHandler} />

{#if hasLauncher}
    <WindowTitleBar />
{/if}

<!--{JSON.stringify(navigationStatus)}-->

<div class="gradient-background">
    <div class="gradient-background-before"></div>
    {#if mobileLayout}
        <MobileTopBar {navigationStatus} mainStore={liveMainStore} />
    {/if}
    <div class="app-layout">
        <PageDisplay page={latestPageNotFound} {navigationStatus} mainStore={liveMainStore}>
            <div class="page-not-found">
                <div>Page not Found!</div>
                <div>{navigationStatus.hash}</div>
                <a href="#main">Return</a>
            </div>
        </PageDisplay>
        <PageDisplay page={latestLoginPage} {navigationStatus} mainStore={liveMainStore}>
            <Login
                permissions={liveMainStore.permissions}
                allowedToClose={!latestLoginPage.forced && !isMobileDevice} />
        </PageDisplay>
        <PageDisplay page={latestOfflineLoginPage} {navigationStatus} mainStore={liveMainStore}>
            <OfflineLoginPage />
        </PageDisplay>
        <PageDisplay page={latestSettingsPage} {navigationStatus} mainStore={liveMainStore}>
            <Settings
                mainStore={liveMainStore}
                selectedCategory={latestSettingsPage.category}
                profilesModified={profilesModifiedNumber}
                localProfilesModified={localProfilesModifiedNumber}
                viewedServerID={latestSettingsPage.serverID} />
        </PageDisplay>
        <PageDisplay page={latestMainPage} {navigationStatus} mainStore={liveMainStore}>
            {@const viewedServerID = latestMainPage.serverID}
            {@const viewedRoomID = latestMainPage.roomID}
            <MainPage
                {mobileLayout}
                mainStore={liveMainStore}
                profilesModified={profilesModifiedNumber}
                {viewedServerID}
                {viewedRoomID} />
        </PageDisplay>
        <PageDisplay page={latestMobileOverviewPage} {navigationStatus} mainStore={liveMainStore}>
            {@const viewedServerID = latestMobileOverviewPage.serverID}
            {@const viewedRoomID = latestMobileOverviewPage.roomID}
            <MobileOverviewPage {viewedServerID} {viewedRoomID} mainStore={liveMainStore} />
        </PageDisplay>
        <PageDisplay page={latestViewServerPage} {navigationStatus} mainStore={liveMainStore}>
            {@const viewedServerID = latestViewServerPage.serverID}
            <MobileServerViewerPage
                {viewedServerID}
                profilesModified={profilesModifiedNumber}
                mainStore={liveMainStore} />
        </PageDisplay>
        {#if popupOpen}
            <div class="popup-container">
                <button class="panel-glass popup-body" on:click={insideClickHandler}>
                    <div class="popup-blur"></div>
                    <PopupContent
                        mainStore={liveMainStore}
                        {popup}
                        profilesModified={profilesModifiedNumber} />
                </button>
            </div>
        {/if}
        <Toasts toasts={liveMainStore.toasts} {isMobileDevice} {autoUpdater} />
    </div>
</div>
