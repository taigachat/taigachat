<script lang="ts">
import type { Immutable } from "../../immutable";
//import { setClientUserCentralUsername } from "../../store";
import type { ClientUser } from "../../store";
import type { Popup } from "../../routes";
import { getCentralURL } from "../../urls";

export let popup: Immutable<Popup>;

export let clientUsers: Immutable<Record<string, ClientUser>>;

let username = "";
let password = "";
let passwordRepeat = "";

let connectError = "";

async function connect() {
    // TODO: Remove once this is reimplemented.
    clientUsers; // eslint-disable-line @typescript-eslint/no-unused-expressions

    // TODO: Reimplement.
    //if (username.indexOf('/') !== -1) {
    //    connectError = 'unsupported username'
    //    return
    //}
    //if (!('connectWithCentral' in popup)) {
    //    return
    //}
    //const clientUser = clientUsers[popup.connectWithCentral]
    //if (clientUser === undefined) {
    //    connectError = 'user could not be found locally'
    //    return
    //}
    //if (password !== passwordRepeat) {
    //    connectError = 'passwords must match'
    //    return
    //}

    //// Find a valid x509 configuration
    //let x509: Immutable<AuthMethodX509RSAPKI>|undefined = undefined
    //for (const method of clientUser.authMethods) {
    //    if (method.type ===  AuthMethodNames.X509_RSA_PKI) {
    //        x509 = method
    //        break
    //    }
    //}
    //if (x509 === undefined) {
    //    connectError = 'this user has no x509 authentication method configured'
    //    return
    //}

    //const currentUsername = username

    //const iv = await randomIV()
    //const encryptedKey = await encryptKey(x509.privateKey as JsonWebKey, password, iv)

    //const request = await fetch(`${getCentralURL()}/v0/user/${username}/connect`, {
    //    method: 'POST',
    //    body: JSON.stringify({
    //        user: {
    //            chain: x509.chain,
    //            keyEncryption: STANDARD_KEY_ENCRYPTION_METHOD,
    //            encryptedKey,
    //            iv: toBase64(iv),
    //        },
    //        password: await hashPassword(password)
    //    })
    //})

    //if (!request.ok) {
    //    connectError = await request.text()
    //    return
    //}

    //setClientUserCentralUsername(clientUser.localID, currentUsername)
    //closePopup()
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

{#if "connectWithCentral" in popup}
    <div class="connect-instructions">
        Connect your account to {getCentralURL()}
    </div>
    <form autocomplete="off">
        <div>
            <input class="panel-glass" autocomplete="username" bind:value={username} placeholder="Username" />
        </div>
        <div>
            <input
                class="panel-glass"
                autocomplete={null}
                type="password"
                bind:value={password}
                placeholder="Password" />
        </div>
        <div>
            <input
                class="panel-glass"
                autocomplete={null}
                type="password"
                bind:value={passwordRepeat}
                placeholder="Repeat Password" />
        </div>
    </form>
    <button on:click={connect} class="big-button green">Connect</button>

    <div class="connect-error">{connectError}</div>
{/if}
