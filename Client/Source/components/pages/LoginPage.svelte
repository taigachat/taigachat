<script lang="ts">
import { addClientUser } from "../../acts";
import { clientName } from "../../edition";
import { randomBase64 } from "../../encoding_schemes";
import { closePage } from "../../routes";
import Icon from ".././Icon.svelte";
import { back } from "../../icons";
import { isForbiddenUsername, loginUserUsingCentral, registerUserUsingCentral } from "../../auth";
import { askForPermission } from "../../permission_requester";
import type { QueriedPermissions } from "../../device_permissions";
import type { Immutable } from "../../immutable";

export let allowedToClose: boolean;
export let permissions: Immutable<QueriedPermissions>;

let loginError = "";
let registering = false;
let successfulRegister = false;

// TODO: Add a spinny thing that gives the user the feedback that the request is being processed
let working = false;

let username = "";
let password = "";
let passwordRepeat = "";

function handleNewUserAdded() {
    closePage();
    askForPermission(permissions, "notifications");
}

// TODO: Reimplement. Perhaps in the main.ts when we handle the storing of new credentials.
//if (centralUsername) {
//    // TODO: Really, this should be called everytime a profile is loaded by startup and through insertProfile()
//    await insertLocalProfile(verification.authID, {
//        userName: centralUsername,
//        timestamp: 1,
//    }, privateKey, PemConverter.decodeFirst(chainUnparsed))
//}

async function centralLogin() {
    if (working) {
        return;
    }

    loginError = "";

    const centralUsername = username.toLowerCase();
    if (isForbiddenUsername(centralUsername)) {
        loginError = "unsupported username";
        return;
    }

    try {
        working = true;
        const localID = `cl-${username}-${randomBase64(8)}`;
        const centralJWT = await loginUserUsingCentral(localID, username, password);
        await addClientUser({
            localID,
            centralUsername: username,
            centralLoginJWT: centralJWT,
            supersededBy: "",
            extraSecurity: [],
            serverLock: undefined,
            mainIdentifier: { missing: {} },
        });
        handleNewUserAdded();
    } catch (e) {
        loginError = `${e}`;
        console.error(e);
    } finally {
        working = false;
    }
}

async function centralRegister() {
    if (working) {
        return;
    }

    loginError = "";

    const centralUsername = username.toLowerCase();
    if (isForbiddenUsername(centralUsername)) {
        loginError = "unsupported username";
        return;
    }

    if (password !== passwordRepeat) {
        loginError = "passwords don't match";
        return;
    }

    try {
        working = true;
        const localID = `cl-${username}-${randomBase64(8)}`;
        const centralJWT = await registerUserUsingCentral(localID, username, password);
        await addClientUser({
            localID,
            centralUsername: username,
            centralLoginJWT: centralJWT,
            supersededBy: "",
            extraSecurity: [],
            mainIdentifier: { missing: {} },
        });
        handleNewUserAdded();
    } catch (e) {
        loginError = `${e}`;
        console.error(e);
    } finally {
        working = false;
    }
}
</script>

<style>
.login-background {
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
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
        <button class="close-authentication" on:click={closePage}>
            <Icon icon={back} size="32" />
        </button>
    {/if}
    <div class="login">
        {#if registering}
            <button class="login-back" on:click={() => (registering = false)}>&lt;</button>
            <span class="login-text">New Account</span>
            <form>
                <input
                    class="panel-glass"
                    autocomplete="username"
                    bind:value={username}
                    placeholder="Username" />
                <input
                    class="panel-glass"
                    autocomplete="new-password"
                    type="password"
                    bind:value={password}
                    placeholder="Password" />
                <input
                    class="panel-glass"
                    autocomplete="new-password"
                    type="password"
                    bind:value={passwordRepeat}
                    placeholder="Repeat Password" />
            </form>
            <div>
                <button on:click={centralRegister} class="big-button blue">Register</button>
            </div>
        {:else}
            <span class="login-text">{clientName}</span>
            <form>
                <input
                    class="panel-glass"
                    autocomplete="username"
                    bind:value={username}
                    placeholder="Username" />
                <input
                    class="panel-glass"
                    autocomplete="current-password"
                    type="password"
                    bind:value={password}
                    placeholder="Password" />
            </form>
            <span class="login-or-register">
                <button on:click={centralLogin} class="big-button green">Login</button>
                <button
                    on:click={() => {
                        registering = true;
                        loginError = "";
                    }}
                    class="big-button blue">Register</button>
                <!-- TODO: Register button is a bit too eye-catching, perhaps remove border? -->
            </span>
        {/if}
        {#if loginError}
            <div class="login-error">{loginError}</div>
        {/if}
        {#if successfulRegister}
            <div class="register-success">
                User successfully registered. Please wait for your friend to invite you.
            </div>
        {/if}
        {#if working}
            Working...
        {/if}
        <a href="#offline-login">Other Methods</a>
    </div>
</div>
