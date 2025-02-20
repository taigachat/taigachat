<script lang="ts">
import type { MainStore } from "../store";
import type { Immutable } from "../immutable";
import { closePopup } from "../routes";
import type { Popup } from "../routes";

import UserCard from "./popups/UserCard.svelte";
import EmojiPicker from "./popups/EmojiPicker.svelte";
import ImageViewer from "./popups/ImageViewer.svelte";
import ConfirmDeleteMessage from "./popups/ConfirmDeleteMessage.svelte";
import ConnectWithCentral from "./popups/ConnectWithCentral.svelte";
import Changelog from "./popups/Changelog.svelte";
import AddServer from "./popups/AddServer.svelte";
import RequestPermissions from "./popups/RequestPermissions.svelte";
import AddEndToEndKey from "./popups/AddEndToEndKey.svelte";

export let mainStore: Immutable<MainStore>;
export let popup: Popup;
export let profilesModified: number;

$: servers = mainStore.servers;
$: clientUsers = mainStore.clientUsers;
</script>

<style>
.popup-inner {
    position: relative;
    z-index: 150; /* TODO: Create variables for z-index or remove them */
}
.popup-cross {
    position: absolute;
    top: 8px;
    right: 12px;
}
</style>

<div class="popup-inner">
    <AddServer {popup} />
    <UserCard {popup} {servers} {profilesModified} audioLevels={mainStore.audioLevels} />
    <EmojiPicker {popup} {servers} />
    <ImageViewer {popup} />
    <ConfirmDeleteMessage {popup} />
    <ConnectWithCentral {popup} {clientUsers} />
    <Changelog
        changelogIndex={mainStore.miscConfig.changelogIndex}
        showChangelog={"showChangelog" in popup} />
    <RequestPermissions permissions={mainStore.permissions} {popup} />
    <AddEndToEndKey {popup} {servers} />
    <button on:click={closePopup} class="popup-cross cross-button"> X </button>
</div>
