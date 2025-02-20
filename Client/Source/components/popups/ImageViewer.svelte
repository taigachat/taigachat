<script lang="ts">
import type { Immutable } from "../../immutable";
import type { Popup } from "../../routes";
import { isElectron } from "../../options";

export let popup: Immutable<Popup>;

async function copyImage() {
    if (!("viewImage" in popup)) {
        return;
    }
    if (isElectron && popup.viewImage !== undefined) {
        const image = await fetch(popup.viewImage);
        const arrayBuffer = await image.arrayBuffer();
        // TODO: For some strange reason it won't accept anything but image/png... But it seems to work so.
        const blob = new Blob([arrayBuffer], { type: "image/png" });
        navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    }
}

function copyLink() {
    if ("viewImage" in popup) {
        try {
            navigator.clipboard.writeText(popup.viewImage);
        } catch (_e) {
            // Ignore the failure.
        }
    }
}
</script>

<style>
.image-viewer {
    width: auto;
}
.image-viewer img {
    max-width: 75vw;
    max-height: 75vh;
}
</style>

{#if "viewImage" in popup}
    <div class="image-viewer">
        <img alt="attachment" src={popup.viewImage} />
        <div>
            {#if isElectron}
                <button class="big-button blue" on:click={copyImage}>Copy</button>
            {/if}
            <button class="big-button blue" on:click={copyLink}>Copy Link</button>
        </div>
    </div>
{/if}
