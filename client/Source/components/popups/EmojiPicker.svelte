<script lang="ts">
import { setServerRoomDraftedMessage } from "../../store";
import type { MainStore } from "../../store";
import { getEmojis } from "../../emojis";
import type { Emoji } from "../../emojis";
import type { Popup } from "../../routes";
import type { Immutable } from "../../immutable";

interface EmojiPickerProps {
    popup: Popup;
    servers: Immutable<MainStore["servers"]>;
}

let { popup, servers }: EmojiPickerProps = $props();

let emojis = $state([] as Emoji[]);

function replaceEmojis(e: Emoji[]) {
    emojis = e;
}

let draftedMessage = "";
$effect(() => {
    if ("emojiPicker" in popup) {
        if (emojis.length == 0) {
            getEmojis()
                .then(replaceEmojis)
                .catch((e) => console.error("error while loading emojis:", e));
        }
        const server = servers[popup.emojiPicker.serverID];
        if (server) {
            const room = server.rooms[popup.emojiPicker.roomID];
            if (room) {
                draftedMessage = room.draftedMessage;
            }
        }
    }
});

function addEmoji(emoji: Emoji) {
    return () => {
        if ("emojiPicker" in popup) {
            setServerRoomDraftedMessage(
                popup.emojiPicker.serverID,
                popup.emojiPicker.roomID,
                draftedMessage + emoji.emoji
            );
        }
    };
}

let nameFilter = $state("");

const filteredEmojis = $derived(
    nameFilter === ""
        ? emojis.filter((e) => e.category.indexOf("Smileys & Emotion") !== -1)
        : emojis.filter((e) => e.name.indexOf(nameFilter) !== -1)
);
const truncatedEmojis = $derived(filteredEmojis.slice(0, 80));
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

{#if "emojiPicker" in popup}
    <div class="emoji-picker">
        <div>
            Results: {filteredEmojis.length}
        </div>
        <div>
            <input bind:value={nameFilter} class="panel-glass" />
        </div>
        <div class="panel-glass emoji-list">
            {#each truncatedEmojis as emoji}
                <button onclick={addEmoji(emoji)}>
                    {emoji.emoji}
                </button>
            {/each}
        </div>
        This is an early alpha emoji picker.
    </div>
{/if}
