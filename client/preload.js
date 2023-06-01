// TODO: Delete this file
/*const { contextBridge, ipcRenderer } = require('electron')


let shortcutCallback = (_s, _d) => {}
let scanCodeCallback = (_s) => {}

const api = {
    isElectron: true,
    getVersion() {
        return ipcRenderer.invoke('get-version')
    },
    getPlatform() {
        return ipcRenderer.invoke('get-platform')
    },
    getIsDeveloper() {
        return ipcRenderer.invoke('is-developer')
    },
    getIsActive() {
        return ipcRenderer.invoke('is-active')
    },
    openURL(url) {
        return ipcRenderer.send('open-url', url)
    },
    downloadURL(url) {
        return ipcRenderer.send('download-url', url)
    },
    saveClient(url, bytes) {
        return ipcRenderer.send('save-client', url, bytes)
    },
    restartClient() {
        return ipcRenderer.send('restart-client')
    },
    setShortcuts(shortcuts) {
        return ipcRenderer.send('set-shortcuts', shortcuts)
    },
    setShortcutCallback(callback) {
        shortcutCallback = callback
    },
    setScanCodeCallback(callback) {
        scanCodeCallback = callback
    },
}

contextBridge.exposeInMainWorld('desktopApp', api)

ipcRenderer.on('shortcut-pressed', (_event, shortcut, down) => {
    shortcutCallback(shortcut, down)
})

ipcRenderer.on('scan-code-pressed', (_event, scanCode) => {
    scanCodeCallback(scanCode)
})
*/
