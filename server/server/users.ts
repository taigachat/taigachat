import type { ServerUser } from './schema.ts'
import { EpisodicStore, insertUpdate } from './versioned.ts'
import { openDocSingleton, documentChanged, DocumentSavable } from './json.ts'
import { getLog } from './log.ts'

export let serverUsers: EpisodicStore<ServerUser, 'userID'>
let serverUsersSavable: DocumentSavable<EpisodicStore<ServerUser, 'userID'>>
export let userToIndex: Map<string, number> = new Map()

const { info } = getLog('users')

function modifyServerUser(newServerUser: ServerUser) {
    insertUpdate(serverUsers, userToIndex, newServerUser)
    documentChanged(serverUsersSavable)
}

function getServerUser(userID: string): ServerUser {
    const existingIndex = userToIndex.get(userID)
    if (existingIndex !== undefined) {
        return serverUsers.data[existingIndex]!
    }
    return {
        userID,
        profileTimestamp: 0,
        connected:0,
        lastSeen: 0,
    }
}

export function userWasActive(userID: string) {
    const user = getServerUser(userID)
    user.lastSeen = Math.floor(Date.now() / 1000)
    modifyServerUser(user)
}

export function userGoesOnline(userID: string) {
    const user = getServerUser(userID)
    // TODO: user can be null... somehow?
    info('goes online', user.connected, user.lastSeen)
    user.connected++
    modifyServerUser(user)
}

export function userGoesOffline(userID: string) {
    const user = getServerUser(userID)
    info('goes offline')
    user.connected--
    modifyServerUser(user)
}

export function userChangesProfile(userID: string, profileTimestamp: number) {
    const user = getServerUser(userID)
    info('user profile changed for:', userID, profileTimestamp)
    user.profileTimestamp = profileTimestamp
    modifyServerUser(user)
}

export async function loadData() {
    const container = openDocSingleton('users', {
        idKey: 'userID' as 'userID',
        data: [],
        startIndex: 0,
        length: 0,
    })
    const entry = await container.open()
    serverUsersSavable = [container, entry]
    serverUsers = entry.data
    for(let i = 0; i < serverUsers.data.length; i++) {
        const user = serverUsers.data[i]!
        user.connected = 0
        info('assign:', user, 'to', i)
        userToIndex.set(user.userID, i)
    }
}
