<script lang="ts">
import { navigateTo } from "../routes";
import type { Immutable } from "../immutable";
import type { Server } from "../store";
export let viewedServerID: string;
export let server: Immutable<Server>;
</script>

<style>
.server-list-icon-container {
    padding: 3px 9px;
    display: flex;
}

.server-list-icon-container.selected {
    background-color: var(--background-opacity);
}

.server-list-icon-container:hover .server-list-icon {
    left: 8px;
}
</style>

<button
    on:click={() => navigateTo({ name: "main", serverID: server.serverID, roomID: -1 })}
    class="server-list-icon-container"
    class:selected={server.serverID === viewedServerID}>
    <img alt={"server icon for" + server.serverInfo.name} class="server-list-icon" src={server.icon} />
</button>
