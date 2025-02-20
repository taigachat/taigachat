import type { Immutable } from "./immutable";
import type { Message } from "./schema";
import { strftime } from "./strftime";

export const MESSAGE_TOKENS = /(:\/\/|\\\\|\\?[*_~/]{2}|<|>|\s|&)/;
export const FLAG_BOLD = 1;
export const FLAG_UNDERLINE = 2;
export const FLAG_ITALIC = 4;
export const FLAG_STRIKE = 8;
export const FLAG_NEWLINE = 16;
export const FLAG_LINK = 32;

export enum MessageVisibility {
    DELETED = 1,
    VISIBLE = 2,
    DECRYPTION_PENDING = 3,
    DECRYPTION_FAILED = 4,
}

export enum AttachmentType {
    None,
    File,
    Image,
    Video,
    Audio,
    Loading,
}

interface TextComponent {
    flags: number;
    text: string;
}

export interface ParsedMessageNormal {
    visibility: MessageVisibility;
    msg: Message;
    error: string;
    time: string;
    attachmentType: AttachmentType;
    components: TextComponent[];
}

export type ParsedMessage = ParsedMessageNormal | undefined;

export function parseMessage(
    msg: Immutable<Message>,
    visibility: MessageVisibility,
    messageTimeFormat: string,
    error = ""
): Immutable<ParsedMessage> {
    if (msg.deleted) {
        return undefined;
    }

    let current = { flags: 0, text: "" };
    const components = [current];
    if (typeof msg.content === "string" && error === "") {
        const words = msg.content.split(MESSAGE_TOKENS);
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (word === "**") {
                current = { flags: current.flags, text: "" };
                components.push(current);
                current.flags ^= FLAG_BOLD;
            } else if (word === "__") {
                current = { flags: current.flags, text: "" };
                components.push(current);
                current.flags ^= FLAG_UNDERLINE;
            } else if (word === "~~") {
                current = { flags: current.flags, text: "" };
                components.push(current);
                current.flags ^= FLAG_STRIKE;
            } else if (word === "//") {
                current = { flags: current.flags, text: "" };
                components.push(current);
                current.flags ^= FLAG_ITALIC;
            } else if (word === "\\__") {
                current.text += "__";
            } else if (word === "\\**") {
                current.text += "**";
            } else if (word === "\\~~") {
                current.text += "~~";
            } else if (word === "\\//") {
                current.text += "//";
            } else if (word === "\n") {
                components.push({ flags: FLAG_NEWLINE, text: "" });
                current = { flags: current.flags, text: "" };
                components.push(current);
            } else if ((word === "https" || word === "http") && words[i + 1] === "://") {
                components.push({
                    flags: current.flags | FLAG_LINK,
                    text: word + words[i + 1] + words[i + 2],
                });
                current = { flags: current.flags, text: "" };
                components.push(current);
                i += 2;
            } else {
                current.text += word;
            }
        }
    }

    if (error !== "") {
        // TODO: Make it red?
        current.text = error;
    }

    const date = new Date(msg.time);

    let attachmentType = AttachmentType.None;
    if (msg.attachment) {
        const attachment = msg.attachment;
        if (attachment.mime.startsWith("image/")) {
            attachmentType = AttachmentType.Image;
        } else if (attachment.mime === "video/quicktime") {
            attachmentType = AttachmentType.File;
        } else if (attachment.mime.startsWith("video/")) {
            attachmentType = AttachmentType.Video;
        } else if (attachment.mime.startsWith("audio/")) {
            attachmentType = AttachmentType.Audio;
        } else {
            attachmentType = AttachmentType.File;
        }
    } else if (msg.hasAttachment) {
        attachmentType = AttachmentType.Loading;
    }

    return {
        msg,
        error,

        // TODO: This should probably be moved, or?
        time: strftime(messageTimeFormat, date),
        attachmentType,
        visibility,
        components: components.filter((c) => c.text.length > 0 || c.flags === FLAG_NEWLINE),
    };
}
