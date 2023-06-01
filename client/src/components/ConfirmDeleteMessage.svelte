<script lang="ts">
import type { Immutable } from '../immutable'
import { setPopup, Popup } from '../store'
import { onServer } from '../actions' 

export let viewedServerID: number
export let popup: Immutable<Popup>

function doDeleteMessage() {
    if (popup.confirmDeleteMessage !== undefined) {
        onServer.deleteMessage0(viewedServerID, 
                                popup.confirmDeleteMessage.roomID, 
                                popup.confirmDeleteMessage.chunkID, 
                                popup.confirmDeleteMessage.messageIndex)
    }
    setPopup({})
}
</script>

{#if popup.confirmDeleteMessage !== undefined}
    <div>Do you wish to delete this message?</div>
    <button class="big-button red" on:click={doDeleteMessage}>Delete</button>
{/if}
