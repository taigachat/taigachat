import { onServer } from './actions'
import { serverAddMessageToQueue, serverRemoveMessageFromQueue } from './acts'
import type { MessageAction, MessageActionAttachment, MessageAttachmentIdempotence } from './schema'

let second = 0
let i = 0
function createMessageIdempotence(): string {
    const currentSecond = Math.floor(Date.now() / 1000)
    if (second !== currentSecond) {
        second = currentSecond
        i = 10000
    }
    if (i >= 99999) {
        throw 'too many messageIdempotence generated in under one second'
    }
    i++
    return `${second}${i}`
}

// TODO: Actually save the messageQueue on change

// TODO: Use this function
function computeInformsForMessage(usersInRoom: readonly string[], _content: string): string[] {
    let informs = [] as string[]
    // TODO: Scan for more informs in the message itself.

    return usersInRoom.length < 9 ? [...informs, ...usersInRoom] : informs
}

let attachments: Map<string, File> = new Map()

export async function handleAttachmentURL(serverID: number, idempotence: MessageAttachmentIdempotence) {
    const attachment = attachments.get(idempotence.idempotence)
    if (!attachment) {
        // TODO: Improved error handling
        console.error('attempted to send unknown attachment')
        return
    }
    try {
        // TODO: What if this fails due to already being uploaded?
        const result = await fetch(idempotence.uploadURL, {
            method: 'PUT',

            // TODO: Perhaps just using arrayBuffer directly would be better
            body: attachment,
        })
        console.log('error was: ', await result.text())

        // Now the attachment may be unveiled as it has been sent.
        await onServer.unveilAttachment0(serverID, idempotence);

        serverRemoveMessageFromQueue(serverID, idempotence.idempotence)
    } catch (e) {
        console.error()
    }
}

export async function sendMessageAction(serverID: number, message: MessageAction, data?: File) {
    try {
        await onServer.newMessage0(serverID, message)
        if (data && message.attachment) {
            attachments.set(message.idempotence, data)
        } else {
            serverRemoveMessageFromQueue(serverID, message.idempotence)
        }
    } catch (e) {
        console.error(e)
    }
}

export async function sendMessage(serverID: number, roomID: number, content: string, usersInRoom: readonly string[], attachment?: MessageActionAttachment, data?: File) {
    // TODO: Should usersInRoom be reworked somehow?

    const message: MessageAction = {
        idempotence: createMessageIdempotence(),
        informs: computeInformsForMessage(usersInRoom, content),
        roomID,
        content,
        attachment,
    }
    await serverAddMessageToQueue(serverID, [message, data])
    await sendMessageAction(serverID, message, data)
}

