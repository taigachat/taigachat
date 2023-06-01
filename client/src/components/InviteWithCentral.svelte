<script lang="ts">
import { clientName } from '../branding';

import type { Immutable } from '../immutable'
import type { Popup, ClientUser } from '../store'
import { createUserCertificate, hashPassword, appendCertificate, importKeyJWK } from '../user_chains'
import { getCentralURL } from '../urls'

export let popup: Immutable<Popup>
export let clientUsers: Immutable<Record<string, ClientUser | undefined>>

let password: string
let friend: string
let inviteError: string = ''
let inviteSucceeded = false

$: clientUser = clientUsers[popup.inviter || '']

async function inviteFriend() {
    const centralFriend = friend.toLowerCase()
    if (centralFriend.indexOf('/') !== -1) {
        inviteError = 'unsupported username'
        return
    }
    if (clientUser === undefined || clientUser.centralUsername === undefined) {
        inviteError = 'please connect your own user to central'
        return
    }
    try {
        const keyRequest = await fetch(`${getCentralURL()}/v0/user/${centralFriend}/public_key`)
        if (!keyRequest.ok) {
            inviteError = await keyRequest.text()
            return
        }
        const invitedPublicKeyJWK = await keyRequest.json()
        const invitedPublicKey = await importKeyJWK(invitedPublicKeyJWK, 'verify', true)
        const privateKey = await importKeyJWK(clientUser.key, 'sign')
        const cert = await createUserCertificate(invitedPublicKey, privateKey)
        const appended = appendCertificate(clientUser.chain, cert)

        const inviteRequest = await fetch(`${getCentralURL()}/v0/user/${clientUser.centralUsername.toLowerCase()}/invite/${centralFriend}`, {
            method: 'POST',
            body: JSON.stringify({
                chain: appended,
                password: await hashPassword(password)
            })
        })

        if (!inviteRequest.ok) {
            inviteError = await inviteRequest.text()
            return
        }

        inviteSucceeded = true
    } catch (e) {
        inviteError = `${e}`
        console.error(e)
    }

}

$: clientUsername = clientUser ? clientUser.centralUsername : ''

</script>

<style>
input {
    font-size: 1.1em;
    margin: 4px;
}
.invite-instructions {
    margin-bottom: 6px;
}
.invite-success {
    color: var(--orange1);
}
</style>

{#if popup.inviter !== undefined}
    {#if inviteSucceeded}
        <div class="invite-success">
            Your friend has now been invited to {clientName}! &#10084;&#65039;
        </div>
    {:else}
        <div class="invite-instructions">
            To invite a friend simply enter your password and their username here.
        </div>
        <form>
            <div>
                <input hidden={true} autocomplete="username" bind:value={clientUsername} />
                <input class="panel-glass" autocomplete="current-password" type="password" bind:value={password} placeholder="Confirm your password" />
            </div>
        </form>
        <div>
            <input class="panel-glass" bind:value={friend} placeholder="Friend's username" />
        </div>
        <button on:click={inviteFriend} class="big-button green">Invite</button>
        {#if inviteError !== ''}
            <div>{inviteError}</div>
        {/if}
    {/if}
{/if}
