<script lang="ts">
import { encryptEndToEndKey } from "../../auth";
import type { Immutable } from "../../immutable";
import { closePopup, type Popup } from "../../routes";
import { simpleChanged, type MainStore } from "../../store";

let endToEndKey: string;
export let popup: Immutable<Popup>;
export let servers: Immutable<MainStore["servers"]>;

let errorString = "";

const popupChanged = simpleChanged("addEndToEndKey" in popup ? popup.addEndToEndKey : undefined);

$: if (popupChanged("addEndToEndKey" in popup ? popup.addEndToEndKey : undefined)) {
    errorString = "";
}

async function addEndToEndKey() {
    if (!("addEndToEndKey" in popup)) {
        return;
    }

    if (!endToEndKey) {
        return;
    }

    const server = servers[popup.addEndToEndKey.serverID];
    if (!server) {
        return;
    }

    if (!server.publicSalt) {
        return;
    }

    try {
        const result = await encryptEndToEndKey(
            endToEndKey,
            server.publicSalt,
            popup.addEndToEndKey.expectedFingerprint
        );
        if (result !== "missmatch") {
            closePopup();
        } else {
            errorString = "unexpected fingerprint";
        }
    } catch (_) {
        errorString = "could not generate e2e key";
    }
}
</script>

<style>
.key-input {
    padding: 5px;
}

.key-error {
    color: var(--red1);
}
</style>

{#if "addEndToEndKey" in popup}
    <div>
        <input
            class="key-input panel-glass"
            on:change={addEndToEndKey}
            placeholder="E2E Passphrase"
            bind:value={endToEndKey} />
    </div>

    <button on:click={addEndToEndKey} class="big-button green">Add</button>

    <div class="key-error">
        {errorString}
    </div>
{/if}
