"use strict";

import type { MessageAttachment, UpdateObjectVariants } from "./schema.ts";
import { db } from "./db.js";
import { lastModifiedPosition, scheduleSync } from "./last_modified.js";
import { setLastModifiedToLatest } from "./updater.js";

const FLAG_DELETED = 1;
const FLAG_EDITED = 2;
const FLAG_ATTACHMENT_UNVEILED = 4;

export function createRoom() {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    db.prepare<[string, number, number]>(
        `INSERT INTO rooms
         (title, last_modified, faddishness)
         values (?, ?, ?)`
    ).run("unnamed-room", lastModified, faddishness);
    scheduleSync();
}

export function roomUpdates(results: UpdateObjectVariants[]) {
    const rows = db
        .prepare<
            [],
            {
                room_id: number;
                last_modified: number;
                faddishness: number;
                title: string;
                encrypted_by: string;
                description: string;
                chunk_count: number;
            }
        >(
            "SELECT room_id, last_modified, faddishness, title, encrypted_by, description, chunk_count FROM rooms"
        )
        .all();
    for (const row of rows) {
        results.push({
            type: "room",
            lastModified: row.last_modified,
            faddishness: row.faddishness,
            data: {
                roomID: row.room_id,
                name: row.title,
                description: row.description,
                encryptedBy: row.encrypted_by !== "" ? row.encrypted_by : undefined,
                chunkCount: row.chunk_count,
            },
        });
    }
    setLastModifiedToLatest(results, "room");
}

export function chunkUpdates(roomID: number, chunkID: number, results: UpdateObjectVariants[]) {
    const rows = db
        .prepare<
            [number, number],
            {
                flags: number;
                last_modified: number;
                faddishness: number;
                created: number;
                message_index: number;
                text: string;
                encrypted_by: string;
                attachment: string;
                author: string;
            }
        >(
            "SELECT last_modified, faddishness, created, text, encrypted_by, attachment, flags, author, message_index FROM messages WHERE room = ? AND chunk = ?"
        )
        .all(roomID, chunkID);
    for (const row of rows) {
        results.push({
            type: "message",
            lastModified: row.last_modified,
            faddishness: row.faddishness,
            data: {
                roomID,
                chunkID,
                messageIndex: row.message_index,
                deleted: (row.flags & FLAG_DELETED) === FLAG_DELETED,
                edited: (row.flags & FLAG_EDITED) === FLAG_EDITED,
                attachment:
                    (row.flags & FLAG_ATTACHMENT_UNVEILED) === FLAG_ATTACHMENT_UNVEILED
                        ? JSON.parse(row.attachment)
                        : undefined,
                hasAttachment: row.attachment !== "" ? true : undefined,
                encryptedBy: row.encrypted_by !== "" ? row.encrypted_by : undefined,
                time: row.created,
                userID: row.author,
                content: row.text,
                informs: [], // TODO: Use real value
            },
        });
    }
}

export function deleteRoom(roomID: number) {
    const performDelete = db.transaction(function () {
        const lastModified = Date.now();
        const faddishness = lastModifiedPosition(lastModified);
        db.prepare<[number]>("DELETE FROM rooms WHERE room_id = ?").run(roomID);
        db.prepare<[number]>("DELETE FROM messages WHERE room = ?").run(roomID);

        // Update one of the remaining rooms in order to trigger an update. This is a hack, sort of.
        db.prepare<[number, number]>(
            "UPDATE rooms SET last_modified = ?, faddishness = ? WHERE room_id = (SELECT MIN(room_id) FROM rooms LIMIT 1)"
        ).run(lastModified, faddishness);
    });
    performDelete();
    scheduleSync();
}

export function createMessage(
    userID: string,
    roomID: number,
    content: string,
    encryptedBy: string,
    attachment: MessageAttachment | undefined,
    informs: string[]
) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    const result = db
        .prepare<[number, number, number], { next_message_index: number; chunk_count: number }>(
            `
        UPDATE rooms SET
        chunk_count        = CASE WHEN next_message_index >= messages_per_chunk THEN chunk_count + 1 ELSE chunk_count END,
        next_message_index = (next_message_index % messages_per_chunk) + 1,
        last_modified      = ?,
        faddishness        = ?
        WHERE room_id      = ?
        RETURNING next_message_index, chunk_count
    `
        )
        .get(lastModified, faddishness, roomID);
    if (result === undefined) {
        throw "tried posting message in deleted room";
    }
    const messageIndex = result.next_message_index - 1;

    const attachmentJson = attachment ? JSON.stringify(attachment) : "";

    db.prepare<[number, number, number, string, string, string, string, number, number, number], []>(
        `
        INSERT INTO messages (last_modified, faddishness, created, text, encrypted_by, attachment, author, room, chunk, message_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
        lastModified,
        faddishness,
        lastModified,
        content,
        encryptedBy,
        attachmentJson,
        userID,
        roomID,
        result.chunk_count,
        messageIndex
    );
    scheduleSync();

    return { chunkID: result.chunk_count, messageIndex };
}

export async function unveilMessageAttachment(
    userID: string,
    roomID: number,
    chunkID: number,
    messageIndex: number
) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);

    db.prepare<[number, number, number, number, number, number, string, number], []>(
        `UPDATE messages SET flags = flags | ?, last_modified = ?, faddishness = ? WHERE room = ? AND chunk = ? AND message_index = ? AND author = ? AND flags & ? = 0`
    ).run(
        FLAG_ATTACHMENT_UNVEILED,
        lastModified,
        faddishness,
        roomID,
        chunkID,
        messageIndex,
        userID,
        FLAG_DELETED
    );
    scheduleSync();
}

export function deleteAnyMessage(roomID: number, chunkID: number, messageIndex: number) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);
    db.prepare<[number, number, number, number, number, number], []>(
        `UPDATE messages SET last_modified = ?, faddishness = ?, flags = ?, text = '', attachment = '', author = '', created = 0 WHERE room = ? AND chunk = ? AND message_index = ?`
    ).run(lastModified, faddishness, FLAG_DELETED, roomID, chunkID, messageIndex);
    scheduleSync();
}

export function deleteOwnMessage(roomID: number, chunkID: number, messageIndex: number, userID: string) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);
    db.prepare<[number, number, number, number, number, number, string], []>(
        `UPDATE messages SET last_modified = ?, faddishness = ?, flags = ?, text = '', attachment = '', author = '', created = 0 WHERE room = ? AND chunk = ? AND message_index = ? AND author = ?`
    ).run(lastModified, faddishness, FLAG_DELETED, roomID, chunkID, messageIndex, userID);
    scheduleSync();
}

export function editMessage(
    roomID: number,
    chunkID: number,
    messageIndex: number,
    content: string,
    userID: string
) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);
    db.prepare<[number, number, number, string, number, number, number, string]>(
        `UPDATE messages SET last_modified = ?, faddishness = ?, flags = flags | ?, text = ? WHERE room = ? AND chunk = ? AND message_index = ? AND author = ?`
    ).run(lastModified, faddishness, FLAG_EDITED, content, roomID, chunkID, messageIndex, userID);
    scheduleSync();
}

export function setRoomName(roomID: number, roomName: string) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);
    db.prepare<[string, number, number, number]>(
        `UPDATE rooms SET title = ?, last_modified = ?, faddishness = ? WHERE room_id = ?`
    ).run(roomName, lastModified, faddishness, roomID);
    scheduleSync();
}

export function setRoomEncryptedBy(roomID: number, encryptedBy: string) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);
    db.prepare<[string, number, number, number]>(
        `UPDATE rooms SET encrypted_by = ?, last_modified = ?, faddishness = ? WHERE room_id = ?`
    ).run(encryptedBy, lastModified, faddishness, roomID);
    scheduleSync();
}

export function setRoomDescription(roomID: number, roomDescription: string) {
    const lastModified = Date.now();
    const faddishness = lastModifiedPosition(lastModified);
    db.prepare<[string, number, number, number]>(
        `UPDATE rooms SET description = ?, last_modified = ?, faddishness = ? WHERE room_id = ?`
    ).run(roomDescription, lastModified, faddishness, roomID);
    scheduleSync();
}
