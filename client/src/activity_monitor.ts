import { sendLauncherCommand, registerResponseHandler } from './launcher_bridge'
import { updateLastActivityCheck, MainStore } from './store'
import type { Immutable } from './immutable'
import { onServer } from './actions'

let currentServerIDs: Immutable<number[]> = []

function sendUserActiveHeartbeat() {
    for (const id of currentServerIDs) {
        // TODO: Add some random time here between each server so that servers can't track users.
        onServer.userIsActive0(id)
    }
}
registerResponseHandler('user-is-active', () => {
    sendUserActiveHeartbeat()
})

registerResponseHandler('user-is-inactive', () => {})

export function startUserIsActiveInterval() {
    // TODO: Make a worse version work for web as well.
    setInterval(async () => {
        updateLastActivityCheck()
        sendLauncherCommand('is-active')
    }, 5 * 60 * 1000)
    //}, 2 * 1000)
    // TODO: The interval should be configurable.
}

export function handleStoreChanged(s: Immutable<MainStore>) {
    currentServerIDs = s.serverIDs
}
