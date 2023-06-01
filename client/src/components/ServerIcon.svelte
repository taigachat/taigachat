<script>
import { setViewedServerID } from '../store'
export let viewedServerID
export let server
</script>

<style>
.server-list-icon-container {
    padding: 3px 9px;
}

.server-list-icon-container.selected {
    background-color: var(--background-opacity);
}

.server-list-icon-container:hover .server-list-icon {
    left: 8px;
}
</style>

<div
    on:click={() => setViewedServerID(server.serverID)}
    class="server-list-icon-container"
    class:selected={server.serverID === viewedServerID}>
    <img alt={'server icon for' + server.name} role="button" class="server-list-icon" src={server.icon} />
</div>
