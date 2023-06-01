'use strict'

// TODO: Currently, load functions return Record(s) and not Map(s), should this be changed for saftey?
// We could use Zod to perform the conversion for us...

import { Versioned, globalChange } from './versioned.ts'

let dataPath = './data'

export function setDataPath(path: string) {
    dataPath = path
}

const documentContainers: Map<string, DocumentContainer<any>> = new Map()
let deleteShouldSaveAll = false
let groupBeingDeleted = false

interface DocumentContainer<T> {
    entries: Map<string, Document<T>>
    temporary: boolean // TODO: delete soon
    deleted: boolean
    mkdirPromise?: Promise<any>
}

export interface Document<T> extends Versioned<T> {
    inQueue: boolean
    path: string
    references: number
    entryName: string
    loadPromise?: Promise<void>
    version: number
    data: T
}

export type DocumentSavable<T> = [DocumentContainer<T>, Document<T>]  

const saveList: (DocumentSavable<any>|undefined)[] = []
let saveListIndex = 0

function addToSavingQueue<T>(entry: DocumentSavable<T>) {
    if (!entry[1].inQueue) {
        saveList[saveListIndex++] = entry
        entry[1].inQueue = true
        //console.log(`${path} added to saving queue`)
    }
}

export function closeJsonMap<T>(savable: DocumentSavable<T>) {
    savable[1].references--
    addToSavingQueue(savable)
}

export function documentChanged<T>(savable: DocumentSavable<T>) {
    savable[1].version++
    addToSavingQueue(savable) 
    globalChange()
}

export interface DocumentSingleton<T> extends DocumentContainer<T> {
    /// Provides an async way to open and load JSON files. 
    open: () => Promise<Document<T>> 
}

export function openDocSingleton<T, N extends string>(typeName: N, defaultValue: T, groupName: string = typeName): DocumentSingleton<T> {
    const existingContainer = documentContainers.get(groupName)
    if (existingContainer) {
        return existingContainer as DocumentSingleton<T>
    } else {
        const groupPath = `${dataPath}`
        const group: DocumentSingleton<T> = {
            entries: new Map(),
            deleted: false,
            temporary: false,
            mkdirPromise: undefined,
            open: async function(): Promise<Document<T>> {
                // Sanetize the entry name.
                const entryName = groupName

                let entry = group.entries.get(entryName)
                if (entry === undefined) {
                    entry = {
                        data: structuredClone(defaultValue),
                        path: `${groupPath}/${entryName}.json`,
                        references: 1,
                        entryName,
                        loadPromise: undefined,
                        version: 1,
                        inQueue: false,
                    }
                    entry.loadPromise = loadEntryData(entry)
                    group.entries.set(entryName, entry)
                } else {
                    entry.references++
                }

                // Make sure that data is loaded before returning to the user.
                if (entry.loadPromise) {
                    await entry.loadPromise
                    entry.loadPromise = undefined
                }

                return entry
            }
        }

        // Don't forget to await this elsewhere.
        group.mkdirPromise = Deno.mkdir(groupPath, {recursive: true})
        documentContainers.set(groupName, group)
        return group
    } 
}

export interface DocumentGroup<T> extends DocumentContainer<T> {
    /// Provides an async way to open and load JSON files. 
    open: (entryName: string|number) => Promise<Document<T>>,

    /// Deletes the group.
    delete: () => Promise<void>
}
// TODO: Remove temporary and create an openTmpGroup or something
export function openDocGroup<T>(groupName: string, defaultValue: T, temporary = false): DocumentGroup<T> {
    const existingContainer = documentContainers.get(groupName)
    if (existingContainer) {
        return existingContainer as DocumentGroup<T>
    } else {
        //console.log('create group:', groupName, temporary)
        const groupPath = `${dataPath}/${groupName}`
        const group: DocumentGroup<T> = {
            entries: new Map(),
            deleted: false,
            temporary,
            mkdirPromise: undefined,
            open: async function(entryName: string|number): Promise<Document<T>> {
                // Sanetize the entry name.
                if (typeof entryName === 'string') {
                    if (entryName.length > 245) {
                        throw 'suspected denial-of-service attack due to too long entry name'
                    }
                    entryName = entryName
                        .toString()
                        .replace(/[/]/g, '_')
                        .replace(/[+]/g, '-')
                        .replace(/[\.\\:]/g, '=')
                } else if (typeof entryName === 'number') {
                    entryName = entryName.toString()
                } else {
                    throw 'entryName must either be a number or a string'
                }

                let entry = group.entries.get(entryName)
                if (entry === undefined) {
                    entry = {
                        data: structuredClone(defaultValue),
                        path: `${groupPath}/${entryName}.json`,
                        references: 1,
                        entryName,
                        loadPromise: undefined,
                        version: 1,
                        inQueue: false,
                    }

                    if (!group.temporary) {
                        entry.loadPromise = loadEntryData(entry)
                    }
                    group.entries.set(entryName, entry)
                } else {
                    entry.references++
                }

                // Make sure that data is loaded before returning to the user.
                if (entry.loadPromise) {
                    await entry.loadPromise
                    entry.loadPromise = undefined
                }

                return entry
            },
            delete: async function() {
                const group = documentContainers.get(groupName)
                if (group) {
                    group.deleted = true
                    documentContainers.delete(groupName)
                    groupBeingDeleted = true
                    try {
                        await Deno.remove(groupPath, { recursive: true })
                    } finally {
                        groupBeingDeleted = false
                        if (deleteShouldSaveAll) {
                            deleteShouldSaveAll = false
                            saveAllJson()
                        }
                    }
                }
            }
        }

        if (!temporary) {
            // Don't forget to await this elsewhere.
            group.mkdirPromise = Deno.mkdir(groupPath, {recursive: true})
        }
        documentContainers.set(groupName, group)
        return group
    } 
}

/// The function used for loading a new JSON object from disk.
async function loadEntryData(entry: Document<any>) {
    let text = ''
    try {
        text = await Deno.readTextFile(entry.path+'~~')
    } catch (_) {
        try {
            text = await Deno.readTextFile(entry.path)
        } catch (e) {
            if (e instanceof Deno.errors.NotFound) {
                return
            } else {
                throw e
            }
        }
    }
    const { data, version } = JSON.parse(text)
    entry.data = data
    entry.version = version
}

async function saveJsonEntry<T>(s: DocumentSavable<T>) {
    // Any entry that belongs to a deleted group should not be saved to disk.
    const [group, entry] = s
    if (!group.deleted) {
        const json = JSON.stringify({
            data: entry.data,
            version: entry.version,
        })

        try { 
            if (group.mkdirPromise) {
                await group.mkdirPromise
                group.mkdirPromise = undefined
            }

            if (!group.temporary) {
                // TODO: Do we need to lock the object?

                try {
                    Deno.statSync(entry.path + '~~')
                } catch (e) {
                    if (e instanceof Deno.errors.NotFound) {
                        try {
                            // The ~~ version does not exist. We create it
                            // by (hopefully, depends on FS implementation)
                            // atomically renaming the previous file to ~~
                            await Deno.rename(entry.path, entry.path + '~~')

                            // Keep in mind if this fails due to a not found
                            // then we simply cross our fingers and write
                            // unsafely
                        } catch (e) {
                            if (e instanceof Deno.errors.NotFound) {
                                // This is the first time this file is written because 
                                // both of the previous operations got a NotFound error.
                                // Therefore we write unsafely and return.
                                await Deno.writeTextFile(entry.path, json)
                                return
                            } else {
                                throw e
                            }
                        }
                    } else {
                        throw e
                    }
                }

                // First write to a temporary file, then swap these out.
                await Deno.writeTextFile(entry.path + '~', json)
                await Deno.rename(entry.path + '~', entry.path)
                await Deno.remove(entry.path + '~~')
            }
            entry.inQueue = false
        } catch (e) {
            console.error(e)
        }
    }

    // Garbage collect
    if (entry.references <= 0) {
        // TODO: This is ugly, but is it safer?
        (entry.data as any) = undefined
        group.entries.delete(entry.entryName)
    }
}

export function saveAllJson() {
    if (groupBeingDeleted) {
        deleteShouldSaveAll = true
    } else {
        while (saveListIndex > 0) {
            saveJsonEntry(saveList[saveListIndex - 1]!)
            saveListIndex--
            saveList[saveListIndex] = undefined
        }
    }
}

