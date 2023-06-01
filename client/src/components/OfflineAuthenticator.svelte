<script lang="ts">
import type { Immutable } from '../immutable' 
import { clickSelectsAll } from '../svelte_actions'
import { simpleChanged, Popup, ClientUser } from '../store'
import { appendCertificate, createSessionCertificate, createUserCertificate, importKeyJWK } from '../user_chains'
import { PublicKey } from '@peculiar/x509'

let newSessionID: string

let outputUserChain: string

let authError = ''

export let clientUsers: Immutable<Record<string, ClientUser>>
export let popup: Immutable<Popup>

let inviteDecided = false
let invite = false

const authenticatorChanged = simpleChanged(popup.authenticator)

$: if (authenticatorChanged(popup.authenticator)) {
    outputUserChain = ''
    invite = false 
    inviteDecided = false
}

async function updateUserChain() {
    // Reset so that if no error occurs, we won't show an old error.
    authError = ''

    const clientUser = clientUsers[popup.authenticator || '']

    if (clientUser === undefined) {
        authError = 'cursed error: missing private user keys'
        return
    }
 
    let publicKey: PublicKey
    try {
        publicKey = new PublicKey(newSessionID)
    } catch (e) {
        console.error(e)
        authError = 'badly formatted input'
        return
    }
    const publicKeyCrypto = await publicKey.export()

    console.log(clientUser.key)
    const key = await importKeyJWK(clientUser.key, 'sign')

    const signature = invite 
        ? await createUserCertificate(publicKeyCrypto, key) 
        : await createSessionCertificate(publicKeyCrypto, key)
    const newChain = appendCertificate(clientUser.chain, signature)
    console.log('newChain', newChain)
    // TODO: Maybe verify the chain just to be sure?

    newSessionID = ''
    outputUserChain = newChain

    try {
        navigator.clipboard.writeText(outputUserChain)
    } catch (err) {
        console.error('error while copying user chain to clipboard:', err)
        alert('could not copy token to clipboard')
    }
}

</script>

<style>
textarea {
    font-size: 1.1em;
}
.authenticator {
    width: 340px;
    height: 160px;
}

.authenticator div {
    margin: 8px 0;
}

.authenticator textarea {
    margin: 5px;
}

div.step-0 {
    color: var(--pink1);
}

.auth-error {
    color: var(--red1);
}
</style>

{#if popup.authenticator !== undefined}
    <div class="authenticator">
        {#if !inviteDecided}
            What type of authentication should be done? 
            <br/>
            <br/>
            <button on:click={() => {inviteDecided = true; invite = true}} class="big-button green">Invite a new user</button>
            <br />
            <button on:click={() => {inviteDecided = true; invite = false}} class="big-button yellow">Login on another device</button>
        {:else if outputUserChain}
            {#if invite}
                <div>Send this code to your friend:</div>
            {:else}
                <div>Paste the copied text into YOUR other device:</div>
            {/if}
            <textarea
                readonly
                aria-label="code that should be sent to your friend"
                use:clickSelectsAll
                placeholder="COPY HERE"
                value={outputUserChain} />
        {:else}
            {#if invite}
                <div>Ask your friend to generate a public key.</div>
            {:else}
                <div>First generate a public key on the device you wish to authenticate.</div>
            {/if}
            <div>Then copy the public key into this input box:</div>
            <textarea
                bind:value={newSessionID}
                on:keyup={updateUserChain}
                placeholder="PASTE HERE" />
            <div class="step-0">(offline authentication requires a bit of copy and pasting)</div>
        {/if}
        {#if authError}
            <div class="auth-error">
                {authError}
            </div>
        {/if} 
    </div>
{/if}
