import { launcherPortSecret } from './options'

// TODO there is a problem with running the launcher from WSL2 since the enviromnent variable isn't being properly sent

let bridgeWS: WebSocket|undefined = undefined
let handlers: Record<string, (c: string[], all: string) => void> = {}
let queue: string[] = []
let connecting = false
export function registerResponseHandler(word: string, handler: (c: string[], all: string) => void) {
    handlers[word] = handler
}

function addEventListeners(ws: WebSocket, secret?: string) {
    ws.addEventListener('open', () => {
        ws.send(secret || 'no-secret')
        bridgeWS = ws
        for(const text of queue) {
            ws.send(text)
        }
        queue = []
        connecting = false
    })
    ws.addEventListener('message', (msg) => {
        if (typeof msg.data === 'string') {
            const words = msg.data.split(' ')
            let cmd = words[0] || ''
            if (cmd in handlers) {
                handlers[cmd]!(words, msg.data)
            } else {
                console.warn('no handler for:', msg.data)
            }
        }
    })
    ws.addEventListener('error', (e) => {
        console.error('launcher bridge got error:', e)
        connecting = false
    })
    ws.addEventListener('close', function() {
        console.warn('reconnecting to launcher bridge!')
        if (ws === bridgeWS) {
            connecting = false
        }

        // Reconnect after some time.
        setTimeout(function() {
            if (connecting) {
                return
            }
            startLauncherBridge()
        }, 1000)

        // Make sure that any push to talk buttons are released.
        const handler = handlers['release-all-keys']
        if (handler) {
            handler([], '')
        }
    })
}

export function startLauncherBridge() {
    let [port, secret, _version] = launcherPortSecret.split('-')
    connecting = true
    try {
        let ws = new WebSocket(`ws://127.0.0.1:${port}/launcher-ws`)
        addEventListeners(ws, secret)
        console.log('starting launcher bridge')
    } catch (e) {
        connecting = false
        console.error(e)
    }
}

export function sendLauncherCommand(text: string) {
    if (connecting) {
        queue.push(text)
        return
    }
    if (bridgeWS === undefined) {
        return
    }
    if (bridgeWS.readyState === WebSocket.CLOSED) {
        queue.push(text)
        startLauncherBridge()
        return
    }
    bridgeWS.send(text)
}

; (window as any).debugSendLauncherCommand = sendLauncherCommand
; (window as any).debugCloseLauncher = () => bridgeWS && bridgeWS.close()
