import { registerDebugCommand } from "./debug_mode";
import { clientID } from "./edition";
import type { Immutable } from "./immutable";

// UNLOADED = undefined
export const enum LoadProgress {
    LOADING = 1,
    LOADED = 2,
}

// In case IndexedDB support is missing.
export const fallbackDatabase: Map<string, unknown> = new Map();

const loadStatesMutable: Record<string, LoadProgress> = {};
export const loadStates: Immutable<Record<string, LoadProgress>> = loadStatesMutable;

function loadedHandler(name: string) {
    loadStatesMutable[name] = LoadProgress.LOADED;
}

const databasePromise = new Promise<IDBDatabase>((ok, err) => {
    const databaseRequest = indexedDB.open(clientID, 2);
    databaseRequest.onupgradeneeded = (event) => {
        if (event.oldVersion < 2) {
            databaseRequest.result.createObjectStore("values", {
                keyPath: "name",
            });
        }
    };
    databaseRequest.addEventListener("success", () => ok(databaseRequest.result));
    databaseRequest.addEventListener("error", () => err());
});

registerDebugCommand("deleteDatabase", () => indexedDB.deleteDatabase(clientID));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function savePersistent(name: string, value: any) {
    console.log("saving:", name);
    try {
        const database = await databasePromise;
        database.transaction("values", "readwrite").objectStore("values").put({
            value,
            name,
        });
        loadedHandler(name);
    } catch (_error) {
        fallbackDatabase.set(name, value);
    }
}

export async function loadPersistent<T>(name: string, fallback: T): Promise<T> {
    console.log("loading:", name);
    const fallbackValue = fallbackDatabase.get(name);
    if (fallbackValue !== undefined) {
        // TODO: Use a better clone method with fallback option.
        return JSON.parse(JSON.stringify(fallbackValue));
    }
    try {
        loadStatesMutable[name] = LoadProgress.LOADING;
        const database = await databasePromise;
        return await new Promise<T>((ok) => {
            const t = database.transaction("values", "readonly");
            const request = t.objectStore("values").get(name);
            request.onsuccess = () => {
                loadedHandler(name);
                if (request.result) {
                    ok(request.result.value);
                } else {
                    ok(fallback);
                }
            };
            request.onerror = () => {
                loadedHandler(name);
                ok(fallback);
            };
        });
    } catch (_error) {
        // This is usually triggered by FireFox being in incognito mode.
        fallbackDatabase.set(name, fallback);
        loadedHandler(name);
        return fallback;
    }
}
