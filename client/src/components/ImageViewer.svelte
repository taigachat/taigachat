<script context="module" lang="ts">
declare const ClipboardItem: any;
</script>
<script lang="ts">
import type { Immutable } from '../immutable'
import type { Popup } from '../store'
import { isDesktop } from '../options'

export let popup: Immutable<Popup>

async function copyImage() {
    if (popup.viewImage === undefined) {
        return
    }
    if (isDesktop && popup.viewImage !== undefined) {
        const image = await fetch(popup.viewImage)
        const arrayBuffer = await image.arrayBuffer()
        // TODO: For some strange reason it won't accept anything but image/png... But it seems to work so.
        const blob = new Blob([arrayBuffer], {type: 'image/png'})
        ; (navigator.clipboard as any).write([new ClipboardItem({[blob.type]: blob})])  
    }
}

function copyLink() {
    if (popup.viewImage) {
        try {
            navigator.clipboard.writeText(popup.viewImage)
        } catch(_e) {}
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

{#if popup.viewImage !== undefined}
    <div class="image-viewer">
        <img alt="attachment" src={popup.viewImage} />
        <div>
            {#if isDesktop}
                <button class="big-button blue" on:click={copyImage}>Copy</button>
            {/if}
            <button class="big-button blue" on:click={copyLink}>Copy Link</button>
        </div>
    </div>
{/if}
