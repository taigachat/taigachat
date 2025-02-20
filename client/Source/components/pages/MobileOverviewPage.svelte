<script lang="ts">
import { settings } from "../../icons";
import type { MainStore } from "../../store";
import type { Immutable } from "../../immutable";
import Icon from "../Icon.svelte";
import { navigateTo } from "../../routes";

export let viewedServerID: string;
export let viewedRoomID: number;
export let mainStore: Immutable<MainStore>;

function openSettings() {
    // TODO: Do something useful with these or remove them:
    viewedRoomID; // eslint-disable-line @typescript-eslint/no-unused-expressions
    mainStore; // eslint-disable-line @typescript-eslint/no-unused-expressions

    navigateTo({ name: "settings", serverID: viewedServerID, category: "" });
}
</script>

<style>
.mobile-overview {
    display: flex;
    flex-flow: column nowrap;
}
.overview-entry {
    display: flex;
    width: auto;
    flex-flow: row nowrap;
    fill: var(--icon-color-hover);
    padding: 6px;
    margin: 12px;
    border-radius: 6px;
    align-items: center;
}
.overview-entry-text {
    padding-left: 12px;
}
</style>

<div class="mobile-overview">
    <button class="overview-entry panel-glass" on:click={openSettings}>
        <Icon icon={settings} size={32} />
        <div class="overview-entry-text">Settings</div>
    </button>
</div>
