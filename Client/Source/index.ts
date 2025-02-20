import { isElectron, isDeveloper, hasLauncher } from "./options";
import { dispatchSubscribeAll } from "./dispatch";
import { setIsMobile } from "./store";
import { serverNetCodeSubscribe } from "./netcode";
import { startUserIsActiveInterval } from "./activity_monitor";
import { clientName } from "./edition";
import App from "./components/App.svelte";
import { startKeySSE } from "./keybinds";
import { setSaveKeyActions } from "./auth";
import { clientUserAddMainIdentityKey, rememberEndToEndKey } from "./acts";
import { startPermissionScanning } from "./permission_requester";
import { registerDebugCommand } from "./debug_mode";

function removeStartingCover() {
    const cover = document.getElementsByClassName("starting-cover")[0];
    if (cover !== undefined && cover.parentElement !== null) {
        cover.parentElement.removeChild(cover);
    }
}

if (isDeveloper) {
    removeStartingCover();
} else {
    // We only add .css if we are not in develoepr mode.
    const link = document.createElement("link");
    link.addEventListener("load", removeStartingCover);
    link.addEventListener("error", removeStartingCover);
    link.type = "text/css";
    link.rel = "stylesheet";
    link.href = "./index.css";
    document.head.appendChild(link);
}

async function startServiceWorker() {
    const sw = await navigator.serviceWorker.register("./service-worker.js");
    if (!hasLauncher) {
        sw.addEventListener("updatefound", function () {
            console.warn("A new update has been found! But a nice toast is not implemented yet...");
        });
    }
    /*if (sw.active) {
        setServiceWorkerRegistration(sw)
    }*/
}

function connectSaveEncryptedKeyEvent() {
    setSaveKeyActions(clientUserAddMainIdentityKey, rememberEndToEndKey);
}

async function startApp() {
    document.title = clientName;
    dispatchSubscribeAll();
    connectSaveEncryptedKeyEvent();
    serverNetCodeSubscribe();
    startUserIsActiveInterval();
    startPermissionScanning();

    if ("androidApp" in window) {
        // TODO: Enable notification device permission.

        setIsMobile();
    } else if (/Mobi|Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini|Nokia/i.test(navigator.userAgent)) {
        setIsMobile();
    }

    const app = new App({
        target: document.getElementById("app-container")!,
        props: {},
    });
    registerDebugCommand("app", () => app);

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
            startServiceWorker();
        });
    }

    if (isElectron) {
        // We are running in electron mode.
        const link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = "./static/electron.css";
        document.head.appendChild(link);

        // TODO: Enable notification permissions (and see if they work)

        startKeySSE();
        //startLauncherBridge()
    }
}

startApp();
//export default app
