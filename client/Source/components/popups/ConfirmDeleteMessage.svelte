<script lang="ts">
import type { Immutable } from "../../immutable";
import { closePopup } from "../../routes";
import type { Popup } from "../../routes";
import { onServer } from "../../actions";

export let popup: Immutable<Popup>;

function doDeleteMessage() {
    if ("confirmDeleteMessage" in popup) {
        const data = popup.confirmDeleteMessage;
        onServer.deleteMessage0(data.serverID, data.roomID, data.chunkID, data.messageIndex);
    }
    closePopup();
}
</script>

{#if "confirmDeleteMessage" in popup}
    <div>Do you wish to delete this message?</div>
    <button class="big-button red" on:click={doDeleteMessage}>Delete</button>
{/if}
