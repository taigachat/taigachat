<script lang="ts">
//import { clickSelectsAll } from "../../svelte_actions";
import { clientName } from "../../edition";

// TODO: Add a spinny thing that gives the user the feedback that
// the request is being processed
let username = "";
let password = "";
//let passwordRepeat = ''
</script>

<style>
/* Currently duplicated code from LoginPage.svelte */
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
.login-text {
    font-size: 150%;
    border-bottom: 2px solid var(--white1);
    padding: 10px;
    margin-bottom: 5px;
}
</style>

<div class="login-background">
    <div class="login">
        <span class="login-text">{clientName}</span>
        <form>
            <input class="panel-glass" autocomplete="username" bind:value={username} placeholder="Username" />
            <input
                class="panel-glass"
                autocomplete="current-password"
                type="password"
                bind:value={password}
                placeholder="Password" />
        </form>
    </div>
</div>
