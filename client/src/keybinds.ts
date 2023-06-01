import type { Immutable } from './immutable'
import { MainStore, defaultKeyBindings, setVoicePushToTalkPressed } from './store'
import { sendLauncherCommand, registerResponseHandler } from './launcher_bridge'

function handleKeybind(shortcut: string, down: boolean) {
    if (shortcut === 'pushToTalk') {
        setVoicePushToTalkPressed(down)
    }
}

const NOOP = (_key: number) => {}

let anyKeyHandler = NOOP

let scanCodeToBind: Record<number, string> = {}
let keyNameToBind: Record<string, string> = {}

registerResponseHandler('key', ([_l, keyString, state]) => {
    let key = parseInt(keyString || '') || 0
    if (anyKeyHandler !== NOOP) {
        anyKeyHandler(key)
        anyKeyHandler = NOOP
    } else {
        let k = parseInt(keyString || '') || 0
        let bindName = scanCodeToBind[k]!
        //console.log('state:', bindName, keyString, state, scanCodeToBind, k)
        handleKeybind(bindName, state == '1')
    }
})

registerResponseHandler('release-all-keys', () => {
    for(const code in scanCodeToBind) {
        const bind = scanCodeToBind[code] || ''
        handleKeybind(bind, false)
    }
})

export function handleBrowserKeyPressed(keyName: string, pressed: boolean) {
    if (keyName in keyNameToBind) {
        handleKeybind(keyNameToBind[keyName]!, pressed)
    }
}

export function getNextKey(handler: (key: number) => void) {
    anyKeyHandler = handler
    sendLauncherCommand('enter-keybind-mode')
}

let lastKeybinds = defaultKeyBindings
export function handleStoreChanged(store: Immutable<MainStore>) {
   if (lastKeybinds != store.miscConfig.keyBindings) {
        lastKeybinds = store.miscConfig.keyBindings
        keyNameToBind = {}
        scanCodeToBind = {}
        const scanCodeList = []
        for(const name in lastKeybinds) {
            const keybinding = lastKeybinds[name]
            if (keybinding !== undefined) {
                if (keybinding.global) {
                    scanCodeToBind[keybinding.scanCode] = name
                    scanCodeList.push(keybinding.scanCode)
                } else {
                    keyNameToBind[keybinding.keyName] = name
                }
            }
        }
        sendLauncherCommand(`set-interesting-keys ${scanCodeList.join(' ')}`)
        console.log('keybindings have changed')
   }
}
