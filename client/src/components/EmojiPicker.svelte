<script>
import { setServerRoomDraftedMessage } from '../store'
import { emojis } from '../emojis'

export let popup
export let viewedServerID
export let viewedRoomID
export let draftedMessage

function addEmoji(emoji) {
    return () => {
        setServerRoomDraftedMessage(viewedServerID, viewedRoomID, draftedMessage + emoji.emoji)
    }
}

let nameFilter = ''

$: filteredEmojis =
    nameFilter === ''
        ? emojis.filter((e) => e.category === 'Smileys & Emotion (face-smiling)')
        : emojis.filter((e) => e.name.indexOf(nameFilter) !== -1)
$: truncatedEmojis = filteredEmojis.slice(0, 76)
</script>

<style>
.emoji-list {
    margin: 4px;
    padding: 4px;
}
.emoji-picker {
    width: 400px;
    height: 154px;
}
</style>

{#if popup.emojiPicker}
    <div class="emoji-picker">
        <div>
            Results: {filteredEmojis.length}
        </div>
        <div>
            <input bind:value={nameFilter} class="panel-glass" />
        </div>
        <div class="panel-glass emoji-list">
            {#each truncatedEmojis as emoji}
                <span on:click={addEmoji(emoji)}>
                    {emoji.emoji}
                </span>
            {/each}
        </div>
        This is an early alpha emoji picker.
    </div>
{/if}
