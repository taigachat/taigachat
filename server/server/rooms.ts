'use strict'

import { assertStrictEquals } from 'https://deno.land/std@0.127.0/testing/asserts.ts';
import { openDocGroup, openDocSingleton, DocumentSavable, closeJsonMap, DocumentGroup, documentChanged } from './json.ts'
import { setPermissionOnObject, canUserInContext } from './roles.ts'
import { Room, Chunk, RolePermissionState, MessageAttachment } from './schema.ts'

export interface StoredRoomList {
    nextID: number
    list: number[]
}
let jsonRoomList: StoredRoomList
export let roomListSavable: DocumentSavable<StoredRoomList>

const defaultRoom: Room = {
    permissions: [],
    name: '',
    description: '',
    nextMessageID: 0,
    chunkCount: 0,
    deleted: false,
}
export let roomsGroup: DocumentGroup<Room>


export async function canUserInRoom(permission: string, userID: string, roomID: number) {
    const room = await openRoom(roomID)
    const response = canUserInContext(
        permission,
        userID,
        undefined,
        room[1].data.permissions
    )
    closeJsonMap(room)
    return response
}

async function openRoom(id: number): Promise<DocumentSavable<Room>> {
    // TODO: Detect id out of range!
    const entry = await roomsGroup.open(id)
    return [roomsGroup, entry]
}

export async function createRoom() {
    jsonRoomList.list ||= []
    jsonRoomList.nextID ||= 0

    const id = jsonRoomList.nextID++
    jsonRoomList.list.push(id)
    documentChanged(roomListSavable)

    const savable = await openRoom(id)
    savable[1].data.name = 'unnamed-channel'
    documentChanged(savable)
    closeJsonMap(savable)
}

const defaultChunk: Chunk = {
    messages: []
}

export async function deleteRoom(roomID: number) {
    jsonRoomList.list = jsonRoomList.list.filter((id: number) => id != roomID)
    documentChanged(roomListSavable)
    // TODO: For some reason this isn't enough to update the client.

    const savable = await openRoom(roomID)
    savable[1].data = {
        ...defaultRoom,
        deleted: true,
    }

    // Delete the chunks
    await openDocGroup('room_' + roomID, defaultChunk).delete()

    documentChanged(savable)
    closeJsonMap(savable)
}

const MESSAGE_INDEX_BITS = 9

function chunkID(messageID: number) {
    const mask = ~0 << MESSAGE_INDEX_BITS
    return (messageID & mask) >> MESSAGE_INDEX_BITS
}

function messageIndex(messageID: number) {
    const mask = ~(~0 << MESSAGE_INDEX_BITS)
    return messageID & mask
}

export async function roomChunk(roomID: number, chunkID: number): Promise<DocumentSavable<Chunk>> {
    // TODO: Detect roomID and chunkID not being created yet (exploit, DOS)
    const group = openDocGroup('room_' + roomID, defaultChunk)
    const entry = await group.open(chunkID)
    return [group, entry]
}

export async function createMessage(
    userID: string,
    roomID: number,
    content: string,
    attachment: MessageAttachment|undefined,
    informs: string[]
) {
    const roomSavable = await openRoom(roomID)
    const room = roomSavable[1].data

    if (room.deleted) {
        throw 'tried posting message in deleted room'
    }

    const id = room.nextMessageID++
    const cid = chunkID(id)
    room.chunkCount = cid + 1
    documentChanged(roomSavable)
    closeJsonMap(roomSavable)

    const chunkSavable = await roomChunk(roomID, cid)
    const messageIndex = chunkSavable[1].data.messages.push({
        userID,
        time: Math.floor(Date.now() / 1000),
        content,
        attachment,
        informs,
    }) - 1
    documentChanged(chunkSavable)
    closeJsonMap(chunkSavable)

    return { chunkID: cid, messageIndex }
}

export async function unveilMessageAttachment(userID: string, roomID: number, chunkID: number, messageIndex: number) {
    const chunkSavable = await roomChunk(roomID, chunkID)
    const message = chunkSavable[1].data.messages[messageIndex]
    if (message === undefined) {
        throw 'invalid message'
    }
    if (message.attachment === undefined) {
        throw 'no attachment to unveil'
    }
    if (message.userID !== userID) {
        throw 'this message is not yours to unveil'
    }

    message.attachment.unveiled = true

    documentChanged(chunkSavable)
    closeJsonMap(chunkSavable)
}

export async function deleteMessage(roomID: number, chunkID: number, messageIndex: number, userID: string, janitor: boolean) {
    const chunkSavable = await roomChunk(roomID, chunkID)
    const message = chunkSavable[1].data.messages[messageIndex]
    if (message === undefined) {
        throw 'invalid message'
    }

    if (userID !== message.userID && !janitor) {
        throw 'this message is not yours to delete'
    }

    // TODO: Maybe remove attachments as well.
    message.deleted = true
    message.edited = undefined
    message.userID = ''
    message.content = ''
    message.time = 0
    message.attachment = undefined
    documentChanged(chunkSavable)
    closeJsonMap(chunkSavable)
}

export async function editMessage(
    roomID: number,
    chunkID: number,
    messageIndex: number,
    content: string,
    userID: string
) {
    const chunkSavable = await roomChunk(roomID, chunkID)
    const message = chunkSavable[1].data.messages[messageIndex]
    if (message === undefined) {
        throw 'invalid message'
    }
    if (message.userID !== userID) {
        throw 'this message is not yours to edit'
    }
    message.edited = true
    message.content = content
    documentChanged(chunkSavable)
    closeJsonMap(chunkSavable)
}

export async function setRoomName(roomID: number, roomName: string) {
    const savable = await openRoom(roomID)
    const room = savable[1].data
    if (room.deleted) {
        throw 'can not set name on deleted room'
    }
    room.name = roomName
    documentChanged(savable)
    closeJsonMap(savable)
}

export async function setRoomDescription(roomID: number, roomDescription: string) {
    const savable = await openRoom(roomID)
    const room = savable[1].data
    if (room.deleted) {
        throw 'can not set description on deleted room'
    }
    room.description = roomDescription
    documentChanged(savable)
    closeJsonMap(savable)
}

export async function setRoomRolePermission(roomID: number, roleID: number, permission: string, state: RolePermissionState) {
    const savable = await openRoom(roomID)
    const room = savable[1].data
    if (room.deleted) {
        throw 'can not set permissions on deleted room'
    }

    let role = room.permissions.find((r: any) => r.roleID == roleID)
    if (!role) {
        role = { roleID }
        room.permissions.push(role)
    }

    setPermissionOnObject(role, permission, state)

    documentChanged(savable)
    closeJsonMap(savable)
}

export async function deleteRoomPermissions(roomID: number) {
    const savable = await openRoom(roomID)
    const room = savable[1].data
    if (room.deleted) {
        throw 'can not remove role permissions from deleted room'
    }
    room.permissions = []
    documentChanged(savable)
    closeJsonMap(savable)
}

export async function loadData() {
    const container = openDocSingleton('rooms', {
        nextID: 0,
        list: []
    })
    const entry = await container.open()
    roomListSavable = [container, entry]
    jsonRoomList = entry.data

    roomsGroup = openDocGroup('room', defaultRoom)
}

export function unitTest() {
    assertStrictEquals(chunkID(0), 0)
    assertStrictEquals(chunkID(4), 0)
    assertStrictEquals(chunkID(513), 1)
    assertStrictEquals(chunkID(518), 1)
    assertStrictEquals(chunkID(1023), 1)
    assertStrictEquals(chunkID(1026), 2)
    assertStrictEquals(chunkID(1050), 2)

    assertStrictEquals(messageIndex(518), 6)
}
