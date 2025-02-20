// @ts-check
/// <reference lib="webworker" />

// This will be modified by Vite build.
const appVersion = "0.0.0";

// This will be modified by Vite build.
/** @type {string[]} */
const cachedFiles = [];

const isDeveloper = appVersion === "0.0.0";

/** @type {any} */
const anySelf = self;

/** @type {ServiceWorkerGlobalScope} */
const service = anySelf;

const appPrecache = "v" + appVersion;

const isWeb = service.navigator.userAgent.indexOf("Electron/") === -1; // How can we rewrite this to not use the userAgent? Perhaps Electron can use another Service-Worker that is automatically dervied from this one?

// TODO: Whitelist attachment loading (and other) based on connected servers.

/**
 * @param {string} key
 */
async function deleteCache(key) {
    await caches.delete(key);
}

async function uninstallOldAndClaimClients() {
    const cacheKeepList = [appPrecache];
    const keyList = await caches.keys();
    const cachesToDelete = keyList.filter((key) => !cacheKeepList.includes(key));
    await Promise.all(cachesToDelete.map(deleteCache));
    await service.clients.claim();

    // TODO: Maybe set the version in the indexed db.
}

/**
 * @param {ExtendableEvent} event
 */
function serviceWorkerActivate(event) {
    event.waitUntil(uninstallOldAndClaimClients());
}

async function addToPreCache() {
    if (!isWeb) {
        service.skipWaiting();
        return;
    }
    if (isDeveloper) {
        return;
    }
    const cache = await caches.open(appPrecache);
    cache.addAll(cachedFiles);
}

/**
 * @param {ExtendableEvent} event
 */
function serviceWorkerInstall(event) {
    event.waitUntil(addToPreCache());
}

/**
 * @param {Request} request
 */
async function cacheFirst(request) {
    const cacheMatch = await caches.match(request);
    if (cacheMatch) {
        return cacheMatch;
    }

    // Unfortunately Response.error() is logged.
    // So no point in doing anything fancy here.
    return fetch(request);
}

/**
 * @param {FetchEvent} event
 */
function serviceWorkerFetch(event) {
    /** @type {Request} */
    const request = event.request;

    if (request.url.indexOf("attachment") !== -1 || request.headers.get("accept") === "text/event-stream") {
        // Since web-workers seem to die after 30 seconds in FireFox, we must
        // let the browser take control of the event-stream.
        return;
    }

    const url = new URL(request.url);
    const pathname = url.pathname.startsWith(".") ? url.pathname : `.${url.pathname}`;
    if (cachedFiles.indexOf(pathname) !== -1) {
        event.respondWith(cacheFirst(request));
    }

    // TODO: Return early void if the fetch is coming from netcode.
    // TODO: This todo is not necessary as long as we keep on only calling cacheFirst if the file exists in cachedFiles
}

/**
 * @param {PushEvent} event
 */
async function serviceWorkerPush(event) {
    try {
        const pushData = event.data;
        if (pushData === null) {
            throw "push data was null";
        }
        const data = pushData.text();
        const parsed = JSON.parse(data);
        await service.registration.showNotification("TaigaChat", { body: parsed.message });
    } catch (e) {
        await service.registration.showNotification("TaigaChat", {
            body: `Could not parse notification: ${e}`,
        });
    }
}

if ("ServiceWorkerGlobalScope" in service) {
    service.addEventListener("activate", serviceWorkerActivate);
    service.addEventListener("fetch", serviceWorkerFetch);
    service.addEventListener("install", serviceWorkerInstall);
    service.addEventListener("push", serviceWorkerPush);
}
