<script lang="ts">
import { confirmSystemAllowsNotifications } from '../store'
import { clickSelectsAll } from '../svelte_actions'
import { navigateUp, addClientUser } from '../acts'
import { clientName } from '../branding'
import { exportKeySPKI, importKeyJWK, exportKeyJWK, createSessionCertificate, appendCertificate, verifyX509Chain, hashPassword, decryptKey, randomIV, encryptKey, STANDARD_KEY_ENCRYPTION_METHOD } from '../user_chains'
import { PemConverter, X509Certificates } from '@peculiar/x509'
import { parseX509Chain, ensurePrivateMatchesPublicKey, exportAsSHA512 } from '../x509_chains'
import { toBase64 } from 'encoding_schemes'
import Icon from './Icon.svelte'
import { back } from '../icons'
import { prepareKeyPair, newKeyPair } from '../key_generator'
import { insertProfile } from '../profiles'
import { getCentralURL } from '../urls'

export let allowedToClose: boolean

let loginError = ''
let registering = false
let useCentral = true
let successfulRegister = false

// TODO: Add a spinny thing that gives the user the feedback that
// the request is being processed
let username = ''
let password = ''
let passwordRepeat = ''

let offlineUserLogin = ''
let offlineUserLoginKey: Promise<CryptoKeyPair>|undefined = undefined

prepareKeyPair()

$: {
    // TODO: There are probably better ways of doing this. Like making loginError part of a sub-component
    useCentral
    offlineUserLoginKey
    loginError = ''
    if (!useCentral && offlineUserLoginKey === undefined) {
        offlineUserLoginKey = newKeyPair()
    }
}

async function handleNewUserAdded() {
    await navigateUp()

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().then((result) => {
            if (result === 'granted') {
                confirmSystemAllowsNotifications()
            }
        })
    }
}

async function addUserChainIfValid(privateKey: CryptoKey, chainUnparsed: string, centralUsername?: string) {
    let chain: X509Certificates
    try {
        chain = parseX509Chain(chainUnparsed)
    } catch (e) {
        throw 'could not parse X509 chain'
    }

    // TODO: Provide proper adam
    const verification = await verifyX509Chain(chain, /*[
        // THIS IS BAD
    ]*/)

    const publicKey = await crypto.subtle.exportKey('jwk', await exportAsSHA512(verification.publicSessionKey, 'verify'))
    const privateKeyJWK = await exportKeyJWK(privateKey)
    await ensurePrivateMatchesPublicKey(publicKey, privateKeyJWK)
    console.log('added user chain for user:', verification.userID)
    await addClientUser({
        chain: chainUnparsed,
        key: privateKeyJWK,
        publicKey,
        userID: verification.userID,
        centralUsername,
    })
    if (centralUsername) {
        await insertProfile(verification.userID, {
            userName: centralUsername,
            timestamp: 1,
        }, privateKey, PemConverter.decodeFirst(chainUnparsed))
    }
}

async function offlineUserLoginChanged() {
    loginError = ''

    if (!offlineUserLogin.endsWith('----') || offlineUserLogin.length < 24) {
        return
    }

    if (offlineUserLoginKey === undefined) {
        return
    }

    const key = await offlineUserLoginKey
    try {
        await addUserChainIfValid(key.privateKey, offlineUserLogin)
        useCentral = true
        offlineUserLoginKey = undefined
        await handleNewUserAdded()
    } catch (e) {
        if (typeof e === 'string') {
            loginError = e
        } else {
            throw e
        }
        return
    }
}

async function centralLogin() {
    loginError = ''
    const centralUsername = username.toLowerCase()
    if (centralUsername.indexOf('/') !== -1) {
        loginError = 'unsupported username'
        return
    }
    let keyPair: CryptoKeyPair
    try {
        keyPair = await newKeyPair()
    } catch (_e) {
        loginError = 'could not create a key pair'
        return
    }

    try {
        const request = await fetch(`${getCentralURL()}/v0/user/${centralUsername}/login`, {
            method: 'POST',
            body: await hashPassword(password),
        })
        if (!request.ok) {
            loginError = await request.text()
            return
        }
        const response = await request.json()
        if (response.user !== undefined && response.user.encryptedKey !== undefined) {
            let user = response.user
            let oldKeyJWK: JsonWebKey
            try {
                // TODO: Check the attempt.keyEncryption value in the future.
                oldKeyJWK = await decryptKey(user.encryptedKey,
                                             password,
                                             user.iv);
            } catch (e) {
                loginError = 'could not decrypt private keys'
                console.error(e)
                return
            }

            const oldKey = await importKeyJWK(oldKeyJWK, 'sign')

            const appended = appendCertificate(user.chain,
                                               await createSessionCertificate(keyPair.publicKey, oldKey))
            await addUserChainIfValid(keyPair.privateKey, appended, username)
            await handleNewUserAdded()
        }
    } catch (e) {
        loginError = `${e}`
        console.error(e)
    }
}

async function centralRegister() {
    const centralUsername = username.toLowerCase()
    if (centralUsername.indexOf('/') !== -1) {
        loginError = 'unsupported username'
        return
    }

    let keyPair: CryptoKeyPair
    try {
        keyPair = await newKeyPair()
    } catch (_e) {
        loginError = 'please try again in a short while'
        return

    }

    try {
        const iv = await randomIV()
        const publicKeyJWK = JSON.stringify(await exportKeyJWK(keyPair.publicKey))
        const privateKeyJWK = await exportKeyJWK(keyPair.privateKey)
        const encryptedKey = await encryptKey(privateKeyJWK, password, iv)

        const request = await fetch(`${getCentralURL()}/v0/user/${centralUsername}/register`, {
            method: 'POST',
            body: JSON.stringify({
                user: {
                    chain: '',
                    keyEncryption: STANDARD_KEY_ENCRYPTION_METHOD,
                    encryptedKey,
                    iv: toBase64(iv),
                    publicKey: publicKeyJWK,
                },
                password: await hashPassword(password),
            }),
        })
        if (!request.ok) {
            loginError = await request.text()
            return
        }
        loginError = ''
        successfulRegister = true
        registering = false
    } catch (e) {
        loginError = `${e}`
        console.error(e)
    }
}

</script>

<style>
.login-background {
    top: 0;
    left: 0;
    position: absolute;
    height: 100vh;
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 200;
}

.login {
    position: relative;
    border-radius: 10px;
    padding: 5px 10px;
    min-height: 190px;
    width: 300px;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.login input {
    margin: 3px 5px;
    font-size: 1.2em;
}

.instructions {
    padding: 10px;
}

.login-back {
    position: absolute;
    top: 16px;
    left: 18px;
    font-size: 30px;
    font-variation-settings: var(--bold-text);
    color: var(--blue1);
    cursor: pointer;
}

.login-back:hover {
    border: none;
    background: none;
    color: var(--blue2);
}

.login-text {
    font-size: 150%;
    border-bottom: 2px solid var(--white1);
    padding: 10px;
    margin-bottom: 5px;
}

.central-switch {
    margin: 5px 0 10px 0;
    width: 100%;
}

.login-error {
    color: var(--red1);
}
.register-success {
    color: var(--green1);
}

.close-authentication {
    fill: var(--background-opacity);
    position: absolute;
    top: 30px;
    right: 50px;
    font-size: 30px;
    transition: color 200ms;
}
.close-authentication:hover {
    fill: var(--white1);
}

.login-or-register {
    width: 100%;
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
}
</style>

<div class="login-background">
    {#if allowedToClose}
        <div class="close-authentication" on:click={navigateUp}>
            <Icon icon={back} size="32" />
        </div>
    {/if}
    <div class="login">
        {#if useCentral}
            {#if registering}
                <button class="login-back" on:click={() => registering = false}>&lt;</button> 
                <span class="login-text">New Account</span>
                <form>
                    <input class="panel-glass" autocomplete="username" bind:value={username} placeholder="Username"/>
                    <input class="panel-glass" autocomplete="new-password" type="password" bind:value={password} placeholder="Password"/>
                    <input class="panel-glass" autocomplete="new-password" type="password" bind:value={passwordRepeat} placeholder="Repeat Password"/>
                </form>
                <div>
                    <button on:click={centralRegister} class="big-button blue">Register</button>
                </div>
            {:else}
                <span class="login-text">{clientName}</span>
                <form>
                    <input class="panel-glass" autocomplete="username" bind:value={username} placeholder="Username"/>
                    <input class="panel-glass" autocomplete="current-password" type="password" bind:value={password} placeholder="Password"/>
                </form>
                <span class="login-or-register">
                    <button on:click={centralLogin} class="big-button green">Login</button>
                    <button on:click={() => {registering = true; loginError = ''}} class="big-button blue">Register</button>
                    <!-- TODO: Register button is a bit too eye-catching, perhaps remove border? -->
                </span>
            {/if}
        {:else}
            {#if offlineUserLoginKey}
                {#await offlineUserLoginKey}
                    Please wait while a key pair is created...
                {:then keyPair}
                    {#await exportKeySPKI(keyPair.publicKey) then pem}
                        <div class="instructions">
                            Open another {clientName} client and click "offline authentication" (found in settings).
                        </div>
                        <!-- Add support for loading from file as well. -->
                        <div class="instructions">Then paste the public key below into the text field:</div>
                        <textarea
                            class="panel-glass"
                            readonly={true}
                            use:clickSelectsAll
                            value={pem} />
                        <div class="instructions">When a user chain has been generated. Paste it into the text field below:</div>
                        <textarea class="panel-glass"
                                  bind:value={offlineUserLogin}
                                  on:keyup={offlineUserLoginChanged} />
                    {/await}
                {:catch e}
                    An error occured while creating key pair.
                    <p>
                        {e}
                    </p>
                {/await}
            {:else}
                Key pair generation not started yet.
            {/if}
        {/if}
        {#if loginError}
            <div class="login-error">{loginError}</div>
        {/if}
        {#if successfulRegister}
            <div class="register-success">User successfully registered. Please wait for your friend to invite you.</div>
        {/if}
        <div class="central-switch">
            <div class="toggle-switch" class:toggled={useCentral} on:click={() => useCentral = !useCentral}>
                <div />
            </div>
            Use central server
        </div>
    </div>
</div>
