'use strict'

const cjsRequire = require
const { dialog, app, shell, BrowserWindow, ipcMain, Menu, MenuItem, screen, globalShortcut } = cjsRequire('electron')
const path = cjsRequire('path')
const { version } = cjsRequire('./package.json')

const fs = cjsRequire('fs')
const { chmod, writeFile, rename, rm, copyFile } = cjsRequire('fs/promises')
//const { spawn } = cjsRequire('child_process')

// TODO: Remove cross-env as a dependency.

const launchOptions = {
    // TODO: Remove many of these...
    forceLatest: false,
    ignoreVersion: false,
    safeMode: false,
    ignoreInstanceLock: false,
    webServer: '',
    launcherURL: '',
    // TODO: add ignoreData
}

const launcherBridgePassword = process.env.LAUNCHER_BRIDGE_PASSWORD



/*let globalKeyboardHandler = (_n, _down) => {}

if (process.platform === 'win32') {
    const { setKeyboardCallback } = cjsRequire('./precompiled/win32/addon')
    setKeyboardCallback((n, down) => {
        globalKeyboardHandler(n, down)
    })
}*/

for(let i = 1; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg === 'index.js') {
        continue
    }
    // TODO: Many of these options can be removed...
    if (arg === '--help') {
        console.log('--help for help')
        // TODO: Expand
        process.exit(0)
    } else if (arg === '--force-latest') {
        launchOptions.forceLatest = true
    } else if (arg === '--ignore-version') {
        launchOptions.ignoreVersion = true
    } else if (arg === '--safe-mode') {
        launchOptions.safeMode = true
    } else if (arg === '--web-server') {
        launchOptions.webServer = process.argv[++i]
    } else if (arg === '--ignore-instance-lock') {
        launchOptions.ignoreInstanceLock = true
    } else if (arg === '--auto-start') {
        console.log('started in auto-start mode')
    }
}
// TODO: Add command line option for starting app in 'safe-mode'.
// TODO: Meaning, no servers connected to be default and no connections to the central server.

// TODO: Modify the local DNS if possible to block google IPs in case some botnet code is put into the chromium executable.

//const trueAppPath = process.env['APPIMAGE'] || process.env['PORTABLE_EXECUTABLE_FILE'] || app.getPath('exe')

//const exeInUserData = path.basename(trueAppPath).indexOf(app.getPath('userData')) !== -1

const dataFilePath = path.join(app.getPath('userData'), 'data.json')
const data = {
    bounds: {
        x: undefined,
        y: undefined,
        width: 800,
        height: 600,
    },
    latestExecutable: '',
    latestProcess: 0,
}

if (fs.existsSync(dataFilePath)) {
    try {
        const read = fs.readFileSync(dataFilePath, 'utf8')
        if (read.length > 0) {
            try {
                const obj = JSON.parse(read)
                for (const key in obj) {
                    data[key] = obj[key]
                }
            } catch (e) {
                console.error(e)
            }
        }
    } catch (e) {
        console.error('while loading file:', dataFilePath)
        console.error(e)
        process.exit(1)
    }
}

/*function restartClient() {
    // TODO: Check if argv is correct here...
    // TODO: Put in a timer so that we have time to close the SQL database before the rest loads?
    const next = spawn(data.latestExecutable, [...process.argv.slice(1), '--ignore-instance-lock'], {
        shell: false, // To prevent remote code execution,
        detached: true,
    })
    next.unref()
    app.quit()
}*/

/*const shouldUseNewest = !exeInUserData && app.isPackaged

if ((shouldUseNewest || launchOptions.forceLatest) &&
    data.latestExecutable !== trueAppPath &&
    !launchOptions.ignoreVersion &&
    fs.existsSync(data.latestExecutable)) {

    // TODO: Check if version is actually higher and if so don't restart.
    //console.log(data.latestExecutable, trueAppPath, exeInUserData)

    console.log('switching to the upgraded version of the client:', data.latestExecutable)
    restartClient()

    // We should hopefully never reach this code since app.quit() should do the job for us.
    process.exit(1)
}*/

//const appUnlocked = launchOptions.ignoreInstanceLock || app.requestSingleInstanceLock()

/*async function saveData(ignoreUmatchingPID) {
    if (!appUnlocked) {
        console.log('did not save because app already running')
        return
    }
    if (!ignoreUmatchingPID && fs.existsSync(dataFilePath)) {
        try {
            const read = fs.readFileSync(dataFilePath, 'utf8')
            if (read.length > 0) {
                try {
                    const obj = JSON.parse(read)
                    if (obj.latestProcess !== undefined) {
                        if (obj.latestProcess !== process.pid) {
                            console.log('skipping save')
                            return
                        }
                    }
                } catch (e) {
                    console.error(e)
                }
            }
        } catch (e) {
            console.error('while loading file:', dataFilePath)
            console.error(e)
        }
    }

    await writeFile(dataFilePath, JSON.stringify(data))
}*/

/*if (appUnlocked) {
    data.latestProcess = process.pid
    saveData(true)
} else {
    console.log('client already running in another window')
    process.exit(0)
}*/

//app.commandLine.appendSwitch('enable-features', 'RawClipboard')

app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
    if (url.startsWith('https://localhost:')) {
        event.preventDefault();
        callback(true);
    } else {
        console.log('unknown certificate for:', url) // TODO: Report this in the GUI as well?
    }
});

//ipcMain.handle('get-version', () => version)
//ipcMain.handle('get-platform', () => process.platform)
//ipcMain.handle('is-developer', () => !app.isPackaged)

// TODO: Instead of detecting mouse movements, which can happen due to a pet moving by
// We should instead detect button clicks. This also feels less creepy.
//let lastCursorX = 0
//let lastCursorY = 0
/*ipcMain.handle('is-active', () => {
    const point = screen.getCursorScreenPoint()
    if (point.x !== lastCursorX || point.y !== lastCursorY) {
        //console.log('cursor moved!')
        lastCursorX = point.x
        lastCursorY = point.y
        return true
    }
    return false
})*/

//ipcMain.on('restart-client', restartClient)

/*ipcMain.on('open-url', (_event, url) => {
    shell.openExternal(url)
})*/

/*ipcMain.on('save-client', async (_event, baseFileName, bytes) => {
    if (baseFileName.indexOf('/') !== -1 || baseFileName.indexOf('\\') !== -1) {
        return
    }
    // TODO: Check for diskspace and report error!

    // TODO: Verify signature here as well so that an exploit can't gain access to anything outside of the sandbox.

    const oldFileName = path.join(app.getPath('userData', "OLD_" + baseFileName))
    const fileName = path.join(app.getPath('userData'), baseFileName)

    if (fs.existsSync(fileName)) {
        await rm(oldFileName, {force: true})
        await rename(fileName, oldFileName)
    }

    await writeFile(fileName, Buffer.from(bytes))
    await chmod(fileName, 0o755)
    data.latestExecutable = fileName
    await saveData(false)

    // TODO: Wrap in a todo and catch errors
})*/

async function launchApp() {
    process.on('SIGINT', function () {
        app.quit()
    })

    const win = new BrowserWindow({
        titleBarStyle: 'hidden',
        /*trafficLightPosition: {
            x: 15,
            y: 13,  // TODO: For MacOS: (14px) if you want them vertically centered, set this to titlebar_height / 2 - 7.
        },*/
        width: data.bounds.width,
        height: data.bounds.height,
        x: data.bounds.x,
        y: data.bounds.y,
        backgroundColor: '#434c5e',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            nativeWindowOpen: true,
            sandbox: true,
            contextIsolation: true,
            //preload: path.join(__dirname, 'preload.js'),
            spellcheck: true,
        },
        //icon: path.join('build', 'icon-32.png'),
        icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
        show: false,
    })
    //dialog.showErrorBox('icon', path.join(app.getAppPath(), 'build', 'icon.ico')) 

    let currentShortcuts = {}
    // TODO: All ipcMain things will be removed shortly
    ipcMain.on('set-shortcuts', (_event, shortcuts) => {
        if (Object.keys(currentShortcuts).length > 10) {
            console.error('a very suspicious set-shortcuts command was received')
        } else {
            currentShortcuts = shortcuts
            //console.log(currentShortcuts)
        }
    })

    /*globalKeyboardHandler = (n, down) => {
        //console.log('n:', n, down)
        if (win.isFocused()) {
            // We don't want a compromised client to be able to keylog that easily.
            // Therefor this event is only sent if the window is focused, since the client
            // has access to that anyway.
            win.webContents.send('scan-code-pressed', n)
        } else if (n in currentShortcuts) {
            // The browser seems to want to handle 'focused' event on its own.
            // A theory is that it is WebRTC somehow hijacking our event loop.
            // Either way, it doesn't hurt us.
            win.webContents.send('shortcut-pressed', currentShortcuts[n], down)
        }
    }*/   

    app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
        // TODO: What happens now that we have a launcher managing it?
        if (win) {
            if (win.isMinimized()) {
                win.restore()
            }
            win.focus()
        }
    })

    ipcMain.on('download-url', (_event, url) => {
        win.webContents.session.downloadURL(url)
    })

    // TODO: Set a custom spellcheck URL:
    //win.session.setSpellCheckerDictionaryDownloadURL('https://bjorkman.pro/dictionaries/')

    win.on('close', () => {
        data.bounds = win.getBounds()
        //await saveData(false)
        app.quit()
    })

    win.once('ready-to-show', () => {
        console.log('window is ready to show')
        win.show()
    })

    win.webContents.on('will-navigate', (event, url) => {
        if ((!url.startsWith('build/')) && (!url.startsWith('http://localhost'))) {
            event.preventDefault()
            shell.openExternal(url)
        }
    })

    win.webContents.on('context-menu', (_event, params) => {
        const menu = new Menu()
        let needsPopup = false

        for (const suggestion of params.dictionarySuggestions) {
            menu.append(new MenuItem({
                label: suggestion,
                click: () => win.webContents.replaceMisspelling(suggestion)
            }))
            needsPopup = true
        }

        if (params.misspelledWord) {
            menu.append(
                new MenuItem({
                label: 'Add to dictionary',
                    click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
                })
            )
            needsPopup = true
        }

        if (needsPopup) {
            menu.popup()
        }
    })

    const searchParams = new URLSearchParams();
    if (launcherBridgePassword) {
        searchParams.set('launcher', launcherBridgePassword)
    }
    searchParams.set('desktop', '1')
    searchParams.set('platform', process.platform)
    searchParams.set('developer', app.isPackaged ? '0' : '1')
    searchParams.set('version', version)

    console.log(launchOptions.launcherURL)
    function loadDevURL() {
        win.loadURL(`${launchOptions.webServer}?${searchParams.toString()}`)
    }

    win.webContents.on('did-fail-provisional-load', () => console.log('failed provisional load'))

    if (launchOptions.webServer == '') {
        await win.loadFile(path.join(app.getAppPath(), 'build', 'index.html'), {search: searchParams.toString()})
        //await win.loadFile(path.join('build', 'index.html'))
    } else {
        win.webContents.on('did-fail-load', () => setTimeout(loadDevURL, 1000))
        loadDevURL()
    }
}

async function launchAppWrapped() {
    try {
        await launchApp()
    } catch (e) {
        console.error(e)
    }
}
app.whenReady().then(launchAppWrapped)
console.log('init done')

// TODO: Add a way to disable this.
/*async function fixAutoStart() {
    if (process.platform === 'win32') {
        const updaterPath = path.join(app.getPath('userData'), 'Launcher.exe')
        //console.log(updaterPath, trueAppPath)
        if (!fs.existsSync(updaterPath)) {
            await copyFile(trueAppPath, updaterPath)
            app.setLoginItemSettings({
                openAtLogin: true,
                path: updaterPath,
                args: ['--force-latest', '--auto-start']
            })
            console.log('creating login item')
        }
    }
}
if (appUnlocked) {
    fixAutoStart()
}*/

/*
// TODO: Write auto start code for both Mac and Windows.

const appFolder = path.dirname(process.execPath)
const updateExe = path.resolve(appFolder, '..', 'Update.exe')
const exeName = path.basename(process.execPath)

app.setLoginItemSettings({
  openAtLogin: true,
  path: updateExe,
  args: [
    '--processStart', `"${exeName}"`,
    '--process-start-args', `"--hidden"`
  ]
})
*/

