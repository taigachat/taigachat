<script lang="ts">
import type { Immutable } from '../immutable'
import { setPopup, setClientUserCentralUsername } from '../store'
import type { Popup, ClientUser } from '../store'
import { hashPassword, encryptKey, randomIV, STANDARD_KEY_ENCRYPTION_METHOD } from '../user_chains'
import { toBase64 } from 'encoding_schemes'
import { getCentralURL } from '../urls'

export let popup: Immutable<Popup>
export let clientUsers: Immutable<Record<string, ClientUser>>

let username = ''
let password = ''
let passwordRepeat = ''

let connectError = ''

async function connect() {
    if (username.indexOf('/') !== -1) {
        connectError = 'unsupported username'
        return
    }
    if (popup.connectWithCentral === undefined) {
        return
    }
    const clientUser = clientUsers[popup.connectWithCentral]
    if (clientUser === undefined) {
        connectError = 'user could not be found locally'
        return
    }
    if (password !== passwordRepeat) {
        connectError = 'passwords must match'
        return
    }

    const currentUsername = username

    const iv = await randomIV()
    const encryptedKey = await encryptKey(clientUser.key as JsonWebKey, password, iv)

    const request = await fetch(`${getCentralURL()}/v0/user/${username}/connect`, {
        method: 'POST',
        body: JSON.stringify({
            user: {
                chain: clientUser.chain,
                keyEncryption: STANDARD_KEY_ENCRYPTION_METHOD,
                encryptedKey,
                iv: toBase64(iv),
            },
            password: await hashPassword(password)
        })
    })

    if (!request.ok) {
        connectError = await request.text()
        return
    }

    setClientUserCentralUsername(clientUser.userID, currentUsername)
    setPopup({})
}

</script>

<style>
input {
    font-size: 1.1em;
    margin: 4px;
}
.connect-error {
    color: var(--red1);
}
.connect-instructions {
    padding-bottom: 8px;
}
</style>

{#if popup.connectWithCentral !== undefined}
    <div class="connect-instructions">
        Connect your account to {getCentralURL()}
    </div>
    <form autocomplete="off">
        <div>
            <input class="panel-glass" autocomplete="username" bind:value={username} placeholder="Username"/>
        </div>
        <div>
            <input class="panel-glass" autocomplete="nope" type="password" bind:value={password} placeholder="Password"/>
        </div>
        <div>
            <input class="panel-glass" autocomplete="nope" type="password" bind:value={passwordRepeat} placeholder="Repeat Password"/>
        </div>
    </form>
    <button on:click={connect} class="big-button green">Connect</button>

    <div class="connect-error">{connectError}</div>
{/if}
