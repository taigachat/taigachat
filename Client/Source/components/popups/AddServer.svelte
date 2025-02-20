<script lang="ts">
import { closePopup } from "../../routes";
import type { Popup } from "../../routes";
import { addServer } from "../../acts";
import { getServerManagerURL } from "../../urls";

export let popup: Popup;

let ipOrInvitation: string;

function naiveAddServer() {
    // This function is naive because it does no checking.
    // It can only handle IPs, and has no clue about invitations...
    if (ipOrInvitation.length > 0) {
        addServer(ipOrInvitation);
        ipOrInvitation = "";
        closePopup();
    }
}

async function createServer() {
    const request = await fetch(`${getServerManagerURL()}/new-server`);
    const data = await request.json();
    const url = data.url;
    if (typeof url !== "string") {
        throw "server manager gave client strange data";
    }
    await addServer(url);
    closePopup();
}
</script>

<style>
.add-server form {
    align-items: center;
    flex-flow: column nowrap;
    display: flex;
    padding: 10px 20px;
}

.add-server-input {
    margin: 3px;
    width: 200px;
    height: 30px;
}
</style>

{#if "addServer" in popup}
    <div class="add-server">
        <form on:submit|preventDefault={naiveAddServer}>
            <input
                bind:value={ipOrInvitation}
                class="add-server-input"
                placeholder="Server IP or invitation" />
            <button type="submit" class="big-button green">Join Server</button>
            <button on:click|preventDefault={createServer} class="big-button green">Create Server</button>
            <button class="big-button blue">Browse Servers</button>
        </form>
    </div>
{/if}
