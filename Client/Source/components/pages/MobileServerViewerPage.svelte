<script lang="ts">
import ServerPanel from "../ServerPanel.svelte";
import type { Immutable } from "../../immutable";
import type { MainStore } from "../../store";

export let mainStore: Immutable<MainStore>;
export let profilesModified: number;
export let viewedServerID: string;

$: viewedServer = mainStore.servers[viewedServerID];
$: viewedServerConnectivityInfo = mainStore.listedServers[viewedServerID];
$: viewedServerUsers = viewedServer ? viewedServer.users : {};
</script>

{#if viewedServer && viewedServerConnectivityInfo}
    <ServerPanel
        users={viewedServerUsers}
        {profilesModified}
        connectivityInfo={viewedServerConnectivityInfo}
        server={viewedServer}
        voice={mainStore.voice}
        activeVoiceServer={mainStore.servers[mainStore.voice.activeServerID]} />
{/if}
