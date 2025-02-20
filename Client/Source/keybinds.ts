import type { Immutable } from "./immutable";
import { defaultKeyBindings, setVoicePushToTalkPressed } from "./store";
import type { MainStore } from "./store";
import { hasLauncher, sendLauncherCommand, launcherSSE } from "./launcher_bridge";

function handleKeybind(shortcut: string, down: boolean) {
    if (shortcut === "pushToTalk") {
        setVoicePushToTalkPressed(down);
    }
}

const NOOP = (_key: number) => {};

let anyKeyHandler = NOOP;

let scanCodeToBind: Record<number, string> = {};
let keyNameToBind: Record<string, string> = {};

export function startKeySSE() {
    const sse = launcherSSE("keys0");
    sse.addEventListener("key0", function (e) {
        const [keyString, state] = (e.data || "").split();
        const key = parseInt(keyString || "") || 0;
        if (anyKeyHandler !== NOOP) {
            anyKeyHandler(key);
            anyKeyHandler = NOOP;
        } else {
            const bindName = scanCodeToBind[key]!;
            //console.log('state:', bindName, keyString, state, scanCodeToBind, k)
            handleKeybind(bindName, state == "1");
        }
    });
}

/*
// TODO: Does not seem to be used anymore.
registerResponseHandler('release-all-keys', () => {
    for(const code in scanCodeToBind) {
        const bind = scanCodeToBind[code] || ''
        handleKeybind(bind, false)
    }
})
*/

export function handleBrowserKeyPressed(keyName: string, pressed: boolean) {
    if (keyName in keyNameToBind) {
        handleKeybind(keyNameToBind[keyName]!, pressed);
    }
}

export function getNextKey(handler: (key: number) => void) {
    if (hasLauncher) {
        anyKeyHandler = handler;
        sendLauncherCommand("enterKeybindMode0");
    }
}

let lastKeybinds = defaultKeyBindings;
export function handleStoreChanged(store: Immutable<MainStore>) {
    if (hasLauncher && lastKeybinds != store.miscConfig.keyBindings) {
        lastKeybinds = store.miscConfig.keyBindings;
        keyNameToBind = {};
        scanCodeToBind = {};
        const scanCodeList = [];
        for (const name in lastKeybinds) {
            const keybinding = lastKeybinds[name];
            if (keybinding !== undefined) {
                if (keybinding.global) {
                    scanCodeToBind[keybinding.scanCode] = name;
                    scanCodeList.push(keybinding.scanCode);
                } else {
                    keyNameToBind[keybinding.keyName] = name;
                }
            }
        }
        sendLauncherCommand(`setInterestingKeys0/${scanCodeList.join("/")}`);
        console.log("keybindings have changed");
    }
}
