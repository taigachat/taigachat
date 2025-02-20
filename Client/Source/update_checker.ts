import type { Immutable } from "./immutable";
import { setAutoUpdaterLatestVersion, setAutoUpdaterProgress } from "./store";
import type { MainStore } from "./store";
import { autoUpdateURL, platform, appVersion } from "./options";
import type { AutoUpdater, MiscConfig } from "./store";
import { toBase64, fromBase64 } from "./encoding_schemes";
import { hasLauncher } from "./options";
import { publicFileKey } from "./auto_updater_key";
import { launcherSSE, sendLauncherCommand } from "./launcher_bridge";
import { addToast } from "./acts";
export let autoUpdater: Immutable<AutoUpdater>;
export let miscConfig: Immutable<MiscConfig>;

const percivalBuffer = new Uint8Array([0x70, 0x65, 0x72, 0x63, 0x69, 0x76, 0x61, 0x6c]);
function doublePercival(arrayBuffer: Uint8Array) {
    const doubleHash = new Uint8Array(arrayBuffer.length * 2 + percivalBuffer.length);
    doubleHash.set(arrayBuffer, 0);
    doubleHash.set(percivalBuffer, arrayBuffer.length);
    doubleHash.set(arrayBuffer, arrayBuffer.length + percivalBuffer.length);
    return doubleHash;
}

let updateSignatures: string[] = [];
let updateFileSize: number = 1;
let updateFileName: string = "";
let updateDone = false;

const NO_CACHE = { method: "GET", cache: "no-store" as RequestCache };

function getUpdateURL() {
    // TODO: check all new URL() and make sure it actually APPENDS the base, and doesn't reem stuff...
    // TODO: todo so, one must have a / at the end of the base!
    // TODO: is this cache-busting even required?
    return new URL(`${platform}.json?anticache=${Date.now()}`, autoUpdateURL).href;
}

// If at least one signature matches for the byte and the public key,
// then we return true. Otherwise we return false.
async function verifyHashSignatures(bytes: ArrayBuffer, signatures: string[]) {
    //console.log('digest:', toBase64(await crypto.subtle.digest('SHA-512', new Uint8Array(bytes))))
    const key = await crypto.subtle.importKey(
        "jwk",
        publicFileKey,
        {
            name: "RSA-PSS",
            hash: "SHA-512",
        },
        false,
        ["verify"]
    );

    for (const signature of signatures) {
        if (
            await crypto.subtle.verify(
                {
                    name: "RSA-PSS",
                    saltLength: 32,
                },
                key,
                fromBase64(signature),
                bytes
            )
        ) {
            return true;
        }
        console.log("signature", signature, "failed");
    }
    return false;
}

export async function downloadUpdate() {
    if (hasLauncher) {
        try {
            const fetchUpdate = await fetch(getUpdateURL(), NO_CACHE);
            const update = await fetchUpdate.json();
            const signatures = update.signatures;
            if (!Array.isArray(signatures)) {
                return;
            }
            const url = update.url;
            const decodedURL = decodeURIComponent(url);
            updateFileName = decodedURL.substring(decodedURL.lastIndexOf("/") + 1);
            updateSignatures = signatures;
            updateFileSize = update.size;
            updateDone = false;

            const parameters = new URLSearchParams();
            parameters.set("filename", updateFileName);
            parameters.set("url", decodedURL);

            const sse = launcherSSE(`downloadUpdate0?${parameters}`);
            sse.addEventListener("error", function () {
                sse.close();
                if (!updateDone) {
                    setAutoUpdaterProgress(-201);
                }
            });
            sse.addEventListener("updateProgress0", function (e) {
                const n = parseInt(e.data || "");
                const progress = Math.max(0, Math.min(100, n / updateFileSize));
                setAutoUpdaterProgress(progress);
            });
            sse.addEventListener("updateUnpacking0", function (_e) {
                setAutoUpdaterProgress(199);
            });
            sse.addEventListener("updateDone0", async function (e) {
                const arrayBuffer = new Uint8Array(fromBase64(e.data || ""));
                const doubleHash = doublePercival(arrayBuffer);
                console.log("double:", toBase64(doubleHash), "signatures:", updateSignatures);
                updateDone = true;
                if (await verifyHashSignatures(doubleHash, updateSignatures)) {
                    await sendLauncherCommand(`setNewestVersion0/${updateFileName}`);
                    await setAutoUpdaterProgress(200);
                } else {
                    console.log("could not verify the signature of the file");
                    await setAutoUpdaterProgress(-200);
                }
                sse.close();
            });
        } catch (e) {
            console.error(e);
            await setAutoUpdaterProgress(-100);
        }
    }
}

export function restartClient() {
    if (hasLauncher) {
        sendLauncherCommand("restartClient0");
    }
    // TODO: What if running on web?
}

const CHECK_FOR_UPDATE_EVERY = 60 * 60 * 1000;
//const CHECK_FOR_UPDATE_EVERY = 1000 * 5

function noop() {}
let autoUpdaterInterval = setTimeout(noop, 0);
let autoUpdaterTimeout = setTimeout(noop, 0);

let enabled = false;
async function attemptAutoUpdate() {
    if (!enabled) {
        return;
    }
    const url = getUpdateURL();
    console.log("checking for client update", url, appVersion);
    try {
        const request = await fetch(url, NO_CACHE);
        const data = await request.json();
        if (oldAutoUpdater && oldAutoUpdater.progress === -101) {
            // Clear the error.
            await setAutoUpdaterProgress(0);
        }
        if (data.version !== appVersion) {
            setAutoUpdaterLatestVersion(data.version, hasLauncher);
        }
    } catch (e) {
        console.error(e);
        await setAutoUpdaterProgress(-101);
    }
}

let oldAutoUpdater: Immutable<AutoUpdater> | undefined = undefined;
export function handleStoreChanged(s: Immutable<MainStore>) {
    const miscConfig = s.miscConfig;
    if (!miscConfig.loaded) {
        return;
    }
    if (miscConfig.autoUpdate !== enabled) {
        enabled = miscConfig.autoUpdate;
        if (enabled && hasLauncher) {
            // TOOD: Handle updates differently in the web mode.
            // Perhaps we could call serviceWorker.update()?
            autoUpdaterInterval = setInterval(attemptAutoUpdate, CHECK_FOR_UPDATE_EVERY);
            autoUpdaterTimeout = setTimeout(attemptAutoUpdate, 2000);
        } else {
            clearInterval(autoUpdaterInterval);
            clearTimeout(autoUpdaterTimeout);
        }
    }
    if (enabled && s.autoUpdater !== oldAutoUpdater && s.autoUpdater.latestVersion !== "0.0.0") {
        oldAutoUpdater = s.autoUpdater;
        if (s.toasts.find((p) => p.color === "update") === undefined) {
            addToast({
                id: "new-update",
                text: "",
                title: "Update",
                color: "update",
            });
        }
    }
}
