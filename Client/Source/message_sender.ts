import { ActionError, onServer } from "./actions";
import { serverAddMessageToQueue, serverRemoveMessageFromQueue } from "./acts";
import { endToEndEncryptMessage } from "./e2e_manager";
import type { MessageAction, MessageActionAttachment, MessageAttachmentIdempotence } from "./schema";
import type { EndToEndEncryptionKey } from "./store";

const START_I = 10000;
let second = 0;
let i = START_I;
function createMessageIdempotence(): string {
    const currentSecond = Math.floor(Date.now() / 1000);
    if (second !== currentSecond) {
        second = currentSecond;
        i = START_I;
    }
    if (i >= 99999) {
        throw "too many messageIdempotence generated in under one second";
    }
    i++;
    return `${second}${i}`;
}

// TODO: Actually save the messageQueue on change

// TODO: Use this function
function computeInformsForMessage(usersInRoom: readonly string[], _content: string): string[] {
    const informs = [] as string[];
    // TODO: Scan for more informs in the message itself.

    return usersInRoom.length < 9 ? [...informs, ...usersInRoom] : informs;
}

const attachments: Map<string, File> = new Map();

export async function handleAttachmentURL(serverID: string, idempotence: MessageAttachmentIdempotence) {
    const attachment = attachments.get(idempotence.idempotence);
    if (!attachment) {
        // If attachments is populated later, then
        // there is still a chance if it is set later, and the server
        // connection is reset (which could happen during test due to
        // uninintentional TCP/IP time-outs.

        // TODO: Improved error handling
        console.error("attempted to send unknown attachment");
        return;
    }
    try {
        // TODO: What if this fails due to already being uploaded?
        const result = await fetch(idempotence.uploadURL, {
            method: "PUT",

            // TODO: Perhaps just using arrayBuffer directly would be better
            body: attachment,
        });

        if (!result.ok) {
            console.log("error was: ", await result.text());
            serverRemoveMessageFromQueue(serverID, idempotence.idempotence);
            return;
        }

        // Now the attachment may be unveiled as it has been sent.
        await onServer.unveilAttachment0(serverID, idempotence);

        serverRemoveMessageFromQueue(serverID, idempotence.idempotence);
    } catch (e) {
        console.error(e);
    }
}

export async function sendMessageAction(serverID: string, message: MessageAction, data?: File) {
    const sendAttachmentNow = data && message.attachment;
    try {
        if (sendAttachmentNow) {
            attachments.set(message.idempotence, data);
        }
        await onServer.newMessage0(serverID, message);

        if (!sendAttachmentNow) {
            // TODO: Maybe we could just always call this.
            serverRemoveMessageFromQueue(serverID, message.idempotence);
        }
    } catch (e) {
        if (e instanceof ActionError) {
            serverRemoveMessageFromQueue(serverID, message.idempotence);
        } else {
            console.error(e);
        }
    }
}

export async function sendMessage(
    serverID: string,
    roomID: number,
    content: string,
    encryptedBy: EndToEndEncryptionKey | undefined,
    usersInRoom: readonly string[],
    attachment?: MessageActionAttachment,
    data?: File
) {
    // TODO: Should usersInRoom be reworked somehow?

    if (encryptedBy) {
        try {
            console.log("maybe encrypt the message using:", encryptedBy);
            const newContent = await endToEndEncryptMessage(encryptedBy, content);

            console.log("result of encryption was:", newContent);
            content = newContent;
        } catch (e) {
            console.error(e);
        }
    }

    const message: MessageAction = {
        idempotence: createMessageIdempotence(),
        informs: computeInformsForMessage(usersInRoom, content),
        encryptedBy: encryptedBy ? encryptedBy.fingerprint : "",
        roomID,
        content,
        attachment,
    };
    await serverAddMessageToQueue(serverID, [message, data]);
    await sendMessageAction(serverID, message, data);
}
