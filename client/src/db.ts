import { clientID } from './branding'
import type { Immutable } from './immutable'

// UNLOADED = undefined
export const enum LoadProgress {
    LOADING = 1,
    LOADED = 2,
}

const loadStatesMutable: Record<string, LoadProgress> = {}
export const loadStates: Immutable<Record<string, LoadProgress>> = loadStatesMutable

function loadedHandler(name: string) {
    loadStatesMutable[name] = LoadProgress.LOADED
}

let databasePromise = new Promise<IDBDatabase>((ok, err) => {
    const databaseRequest = indexedDB.open(clientID, 2)
    databaseRequest.onupgradeneeded = (event) => {
        if (event.oldVersion < 2) {
            databaseRequest.result.createObjectStore('values', {
                keyPath: 'name',
            })
        }
    }
    databaseRequest.addEventListener('success', () => ok(databaseRequest.result))
    databaseRequest.addEventListener('error', () => err())
})

;(window as any).debugDeleteDatabase = () => indexedDB.deleteDatabase(clientID)

export async function savePersistent(name: string, value: any) {
    console.log('saving:', name)
    try {
        const database = await databasePromise
        database.transaction('values', 'readwrite').objectStore('values').put({
            value,
            name,
        })
        loadedHandler(name)
    } catch (_error) {}
}

export async function loadPersistent<T>(name: string, fallback: T) {
    console.log('loading:', name)
    try {
        loadStatesMutable[name] = LoadProgress.LOADING
        const database = await databasePromise
        return await new Promise<T>((ok) => {
            const t = database.transaction('values', 'readonly')
            const request = t.objectStore('values').get(name)
            request.onsuccess = () => {
                loadedHandler(name)
                if (request.result) {
                    ok(request.result.value)
                } else {
                    ok(fallback)
                }
            }
            request.onerror = () => {
                loadedHandler(name)
                ok(fallback)
            }
        })
    } catch (_error) {
        loadedHandler(name)
        return fallback
    }
}

