<script lang="ts">
import { setShowAddServer } from '../store'
import { addServer } from '../acts'
import Icon from './Icon.svelte'
import { back } from '../icons'
import { getServerManagerURL } from '../urls'

export let showAddServer: boolean

let windowHeight: number
let popupPositioner: HTMLDivElement
let popupContent: HTMLDivElement
let ipOrInvitation: string

$: {
    windowHeight && showAddServer
    if (popupContent) {
        const height = popupContent.offsetHeight
        const start = popupPositioner.getBoundingClientRect().top - 105
        popupContent.style.top = `${height + start > windowHeight ? windowHeight - height : start}px`
    }
}

function naiveAddServer() {
    // This function is naive because it does no checking.
    // It can only handle IPs, and has no clue about invitations...
    if (ipOrInvitation.length > 0) {
        addServer(ipOrInvitation)
        ipOrInvitation = ''
        setShowAddServer(false)
    }
}

async function createServer() {
    const request = await fetch(`${getServerManagerURL()}/new-server`)
    const data = await request.json()
    const url = data.url
    if (typeof url !== 'string') {
        throw 'server manager gave client strange data'
    }
    await addServer(url)
    setShowAddServer(false)
}

</script>

<style>
.add-server-panel {
    width: 0;
    overflow: hidden;
    position: fixed;
    top: 0px;
    flex-flow: row nowrap;
    left: 67px;
    display: flex;
    align-items: center;
    transition: width 150ms;
}

.add-server-methods {
    display: flex;
    flex-flow: column nowrap;
    padding: 20px;
    padding-left: 10px;
    margin-left: 16px;
}

.add-server-panel.shown {
    width: 268px;
    transition: width 300ms;
}

.add-server-input {
    margin: 3px;
    width: 200px;
    height: 30px;
}

.add-server-close {
    border-radius: 50%;
    fill: var(--background-opacity);
    height: 40px;
    width: 40px;
    padding: 8px;
    position: absolute;
    right: 20px;
    top: 80px;
}

.add-server-close:hover {
    fill: var(--white1);
}
</style>

<svelte:window bind:innerHeight={windowHeight} />
<div bind:this={popupPositioner} />
<div bind:this={popupContent} class:shown={showAddServer} class="add-server-panel">
    <div class="panel-glass panel-border add-server-methods">
        <form on:submit|preventDefault={naiveAddServer}>
            <input
                bind:value={ipOrInvitation}
                class="add-server-input"
                placeholder="Server IP or invitation" />
            <button type="submit" class="big-button green">Join Server</button>
            <button on:click|preventDefault={createServer} class="big-button green">Create Server</button>
            <button class="big-button blue">Browse Servers</button>
        </form>
    </div>
    <div on:click={() => setShowAddServer(false)} class="add-server-close">
        <Icon icon={back} size="24" />
    </div>
</div>
