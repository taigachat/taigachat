import { getLog } from './log.ts'
const { info } = getLog('versioned')

export interface Versioned<T> {
    data: T,
    version: number
}

// TODO: Explore performance difference in using some builtin addEventListener API instead
let globalChangeListeners: ((() => void)|undefined)[] = []
const freeGlobalChangeIndices: number[] = []

export function addGlobalChangeListener(callback: () => void) {
    if (freeGlobalChangeIndices.length > 0) {
        const index = freeGlobalChangeIndices.pop()!
        globalChangeListeners[index] = callback
        return index
    } else {
        const index = globalChangeListeners.length
        globalChangeListeners.push(callback)
        return index
    }
}

export function removeGlobalChangeListener(index: number) {
    if (index > 0 && index < globalChangeListeners.length) {
        globalChangeListeners[index] = undefined
        freeGlobalChangeIndices.push(index)
    }
}

export function globalChange() {
    for (const listener of globalChangeListeners) {
        if (listener) {
            listener()
        }
    }
}

export async function update<T, V, O>(value: Versioned<V>, into: Versioned<O>, currentVersion: number, additional: T, transformer: (v: V, c: T) => Promise<O>|O): Promise<boolean> {
    if (value.version > currentVersion) {
        into.data = await transformer(value.data, additional)
        into.version = value.version
        return true
    } else {
        return false
    }
}

export function updatePure<V>(value: Versioned<V>, into: Versioned<V>, currentVersion: number): boolean {
    if (value.version > currentVersion) {
        into.data = value.data
        into.version = value.version
        return true
    } else {
        return false
    }
}

// TODO: Maybe come up with a better name for this algorithm?
export interface EpisodicStore<V, K extends keyof V> {
    idKey: K
    data: V[],
    startIndex: number,
    length: number,
}

// Used to detect potential errors in the EpisodicStore implementation.
export function detectInsanity<K>(idToIndex: Map<K, number>) {
    const otherWay = new Map<number, K>()
    for (const [key, value] of idToIndex) {
        if (otherWay.get(value) !== undefined) {
            throw new Error('the idToIndex map has completely lost it')
        }
        otherWay.set(value, key)
    }
}

// Updates a list gradually.
export function updateGradually<V, K extends keyof V>(
                            store: EpisodicStore<V, K>,
                            into: Versioned<V[]>,
                            currentVersion: number): boolean {
    const data = store.data
    const dataLength = store.data.length
    let endAt = store.startIndex + store.length
    info('updateGradually:', store.idKey, currentVersion, endAt)
    into.data = [] // TODO: The capacity could be preallocated
    for(let i = Math.max(store.startIndex, currentVersion); i < endAt; i++) {
        const actualI = i % dataLength
        info('send update:', i, data[actualI])
        //into.data = [data[actualI]!]
        into.data.push(data[actualI]!)
        into.version = i + 1

        // For now we only send one at a time, in the future this might change
        // A max value of 512 would be nice (the size of a chunk)
        return true
    }
    return into.data.length > 0
    //return false
}

function growInsert<V, K extends keyof V>(store: EpisodicStore<V, K>,
                                          idToIndex: Map<V[K], number>,
                                          update: V) {
    const coverIndex = store.data.length
    const finalIndex = (store.startIndex + store.length) % coverIndex
    const fromIndex = store.startIndex % coverIndex
    const coverID = store.data[fromIndex]![store.idKey]
    store.data.push(store.data[fromIndex]!)
    idToIndex.set(coverID, coverIndex)

    const newID = update[store.idKey]
    store.data[finalIndex] = update
    idToIndex.set(newID, finalIndex)

    store.startIndex += 1
    store.length += 1
}

function insertNewUpdate<V, K extends keyof V>(store: EpisodicStore<V, K>,
                                               idToIndex: Map<V[K], number>,
                                               update: V) {
    if (store.data.length === 0) {
        const id = update[store.idKey]!
        store.data.push(update)
        idToIndex.set(id, 0)
        store.length = 1
    } else if (store.data.length > store.length) {
        const id = update[store.idKey]!
        const finalIndex = (store.startIndex + store.length) % store.data.length
        store.length += 1
        store.data[finalIndex] = update
        idToIndex.set(id, finalIndex)
    } else {
        info('growInsert')
        growInsert(store, idToIndex, update)
    }
}

function uncleanRedactIndex<V, K extends keyof V>(
                        store: EpisodicStore<V, K>,
                        id_to_index: Map<V[K], number>,
                        index: number) {
    // Note that this function does not clear the hashmap!
    const finalIndex = store.startIndex % store.data.length
    store.startIndex += 1
    if (index == finalIndex) {
        return
    }
    const coverID = store.data[finalIndex]![store.idKey]
    store.data[index] = store.data[finalIndex]!
    id_to_index.set(coverID, index)
}

function uncleanRedactiveInsert<V, K extends keyof V>(
                            store: EpisodicStore<V, K>,
                            id_to_index: Map<V[K], number>,
                            update: V,
                            lastIndex: number) {
    info('uncleanRedactiveInsert:', update)
    const finalIndex = (store.startIndex + store.length) % store.data.length
    uncleanRedactIndex(store, id_to_index, lastIndex)
    store.data[finalIndex] = update
    id_to_index.set(update[store.idKey], finalIndex)
}

export function insertUpdate<V, K extends keyof V>(
                    store: EpisodicStore<V, K>,
                    id_to_index: Map<V[K], number>,
                    update: V) {
    info('insertUpdate:', update)
    const id = update[store.idKey]
    const lastIndex = id_to_index.get(id)
    if (lastIndex !== undefined) {
        uncleanRedactiveInsert(store, id_to_index, update, lastIndex)
    } else {
        info('insertNewUpdate')
        insertNewUpdate(store, id_to_index, update)
    }
    //detectInsanity(id_to_index)
}

export function redactUpdate<V, K extends keyof V>(
                        store: EpisodicStore<V, K>,
                        id_to_index: Map<V[K], number>,
                        id: V[K]) {
    info('redactUpdate:', id)
    const index = id_to_index.get(id)
    if (index !== undefined) {
        info('redacting:', index)
        id_to_index.delete(id)
        uncleanRedactIndex(store, id_to_index, index)
        store.length -= 1
    }
}

//const list: ({latest: number}|{})[] = []
//updateGradually(list, {version: 0, data: [{latest: 0}]}, 0)
