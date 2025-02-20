// @ts-check
"use strict";

import { app, shell, BrowserWindow, Menu, MenuItem } from "electron";

import path from "path";

import fs from "fs";

const launcherBridgePassword = process.env.LAUNCHER_BRIDGE_PASSWORD;
const launcherWebServer = process.env.LAUNCHER_WEB_SERVER || "";

const webAppLocation = path.join(app.getAppPath(), "Build", "Web");

// TODO: Add command line option for starting app in 'safe-mode'.
// TODO: Meaning, no servers connected to be default and no connections to the central server.

// TODO: Modify the local DNS if possible to block google IPs in case some botnet code is put into the chromium executable.

const dataFilePath = path.join(app.getPath("userData"), "data.json");
const data = {
    /** @type {Electron.Rectangle|undefined} */
    bounds: undefined,
    latestExecutable: "",
    latestProcess: 0,
};

if (fs.existsSync(dataFilePath)) {
    try {
        const read = fs.readFileSync(dataFilePath, "utf8");
        if (read.length > 0) {
            try {
                const obj = JSON.parse(read);
                for (const key in obj) {
                    data[key] = obj[key];
                }
            } catch (e) {
                console.error(e);
            }
        }
    } catch (e) {
        console.error("while loading file:", dataFilePath);
        console.error(e);
        process.exit(1);
    }
}

//app.commandLine.appendSwitch('enable-features', 'RawClipboard')

app.on("certificate-error", (event, _webContents, url, _error, _certificate, callback) => {
    if (url.startsWith("https://localhost:")) {
        event.preventDefault();
        callback(true);
    } else {
        console.log("unknown certificate for:", url); // TODO: Report this in the GUI as well?
    }
});

async function launchApp() {
    process.on("SIGINT", function () {
        app.quit();
    });

    const win = new BrowserWindow({
        titleBarStyle: "hidden",
        /*trafficLightPosition: {
            x: 15,
            y: 13,  // TODO: For MacOS: (14px) if you want them vertically centered, set this to titlebar_height / 2 - 7.
        },*/
        width: data.bounds ? data.bounds.width : 800,
        height: data.bounds ? data.bounds.height : 600,
        x: data.bounds && data.bounds.x,
        y: data.bounds && data.bounds.y,
        backgroundColor: "#434c5e",
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            sandbox: true,
            contextIsolation: true,
            spellcheck: true,
        },
        // TODO: Use the correct icon.ico again
        icon: path.join(webAppLocation, "out", "icon.ico"),
        show: false,
    });
    //dialog.showErrorBox('icon', path.join(app.getAppPath(), 'build', 'icon.ico'))

    app.on("second-instance", (_event, _commandLine, _workingDirectory) => {
        // TODO: What happens now that we have a launcher managing it?
        if (win) {
            if (win.isMinimized()) {
                win.restore();
            }
            win.focus();
        }
    });

    // TODO: Set a custom spellcheck URL:
    //win.session.setSpellCheckerDictionaryDownloadURL('https://taigachat.se/dictionaries/')

    win.on("close", () => {
        data.bounds = win.getBounds();
        //await saveData(false)
        app.quit();
    });

    win.once("ready-to-show", () => {
        console.log("window is ready to show");
        win.show();
    });

    win.webContents.on("will-navigate", (event, url) => {
        // TODO: Move build into a variable.
        if (!url.startsWith("build/") && !url.startsWith("http://localhost")) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    win.webContents.on("context-menu", (_event, params) => {
        const menu = new Menu();
        let needsPopup = false;

        for (const suggestion of params.dictionarySuggestions) {
            menu.append(
                new MenuItem({
                    label: suggestion,
                    click: () => win.webContents.replaceMisspelling(suggestion),
                })
            );
            needsPopup = true;
        }

        if (params.misspelledWord) {
            menu.append(
                new MenuItem({
                    label: "Add to dictionary",
                    click: () =>
                        win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
                })
            );
            needsPopup = true;
        }

        if (needsPopup) {
            menu.popup();
        }
    });

    const searchParams = new URLSearchParams();
    if (launcherBridgePassword) {
        searchParams.set("launcher", launcherBridgePassword);
    }
    searchParams.set("desktop", "1");
    searchParams.set("platform", process.platform);
    searchParams.set("developer", app.isPackaged ? "0" : "1");

    if (!app.isPackaged) {
        searchParams.set("debugMode", "1");
    }

    function loadDevURL() {
        win.loadURL(`${launcherWebServer}/index.html?${searchParams.toString()}`);
    }

    win.webContents.on("did-fail-provisional-load", () => console.log("failed provisional load"));

    if (launcherWebServer == "") {
        await win.loadFile(path.join(webAppLocation, "index.html"), { search: searchParams.toString() });
    } else {
        win.webContents.on("did-fail-load", () => setTimeout(loadDevURL, 1000));
        loadDevURL();
    }
}

async function launchAppWrapped() {
    try {
        await launchApp();
    } catch (e) {
        console.error(e);
    }
}
app.whenReady().then(launchAppWrapped);
console.log("init done");
