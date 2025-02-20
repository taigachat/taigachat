/**
 * @import { EndToEndEncryptionKey } from './store'
 */

/**
 * @import { ParsedMessage } from './message_format'
 */

/**
 * @import { Message } from './schema'
 */

/**
 * @import { Immutable } from './immutable'
 */

import { MessageVisibility, parseMessage } from "./message_format";

import { decryptEndToEndKey } from "./auth";
import { fromBase64, toBase64 } from "./encoding_schemes";

/** A cache of all the loaded e2e keys */
const loadedEndToEndKeys = new Map();

/**
 * @param {EndToEndEncryptionKey} key
 * @returns {Promise<CryptoKey>}
 */
async function loadEndToEndKey(key) {
    const possibleKey = loadedEndToEndKeys.get(key.fingerprint);
    if (possibleKey !== undefined) {
        return possibleKey;
    }
    const cryptoKey = await decryptEndToEndKey(key);
    loadedEndToEndKeys.set(key.fingerprint, cryptoKey);
    return cryptoKey;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const authenticatedData = encoder.encode("TaigaJhnTnjAlxHnrkMrgE2E");

/**
 * @param {EndToEndEncryptionKey|undefined} unloadedKey
 * @param {Immutable<Message>} message
 * @param {string} messageTimeFormat
 */
async function decryptMessage(unloadedKey, message, messageTimeFormat) {
    if (!unloadedKey) {
        return parseMessage(message, MessageVisibility.DECRYPTION_FAILED, messageTimeFormat, "missing key");
    }

    const key = await loadEndToEndKey(unloadedKey);

    const parts = message.content.split("/");

    if (parts.length !== 3 || parts[0] !== "a256gcm") {
        return parseMessage(
            message,
            MessageVisibility.DECRYPTION_FAILED,
            messageTimeFormat,
            "bad encryption format"
        );
    }

    const [_header, iv64, encrypted64] = parts;

    const iv = fromBase64(iv64 || "");
    const encrypted = fromBase64(encrypted64 || "");

    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv, tagLength: 128, additionalData: authenticatedData },
            key,
            encrypted
        );

        const decryptedText = decoder.decode(decrypted);

        return parseMessage(
            { ...message, content: decryptedText },
            MessageVisibility.VISIBLE,
            messageTimeFormat
        );
    } catch (_) {
        return parseMessage(
            message,
            MessageVisibility.DECRYPTION_FAILED,
            messageTimeFormat,
            "decryption failed"
        );
    }
}

/**
 * @param {Immutable<ParsedMessage[]>} encryptedMessages
 * @param {Record<string, EndToEndEncryptionKey>} encryptedKeys
 * @param {(msg: Immutable<ParsedMessage>, previous: Immutable<Message>, i: number) => boolean} messageDecryptedCallback
 * @param {string} messageTimeFormat
 * @returns {Promise<void>}
 */
export async function decryptChunk(
    encryptedMessages,
    encryptedKeys,
    messageDecryptedCallback,
    messageTimeFormat
) {
    for (let i = 0; i < encryptedMessages.length; i++) {
        const encryptedMessage = encryptedMessages[i];
        if (!encryptedMessage) {
            continue;
        }

        if (encryptedMessage.visibility === MessageVisibility.VISIBLE) {
            // Message already decoded. Keep going.
            continue;
        }

        const fingerprint = encryptedMessage.msg.encryptedBy;
        if (!fingerprint) {
            // Not an encrypted message.
            continue;
        }

        const unloadedKey = encryptedKeys[fingerprint];

        const newMessage = await decryptMessage(unloadedKey, encryptedMessage.msg, messageTimeFormat);

        if (messageDecryptedCallback(newMessage, encryptedMessage.msg, i)) {
            // The flip side wants us to keep decrypting.
            // So let's go to the next message.
            continue;
        }

        break;
    }
}

/**
 * @param {EndToEndEncryptionKey} encryptedEndToEndKey
 * @param {string} message
 */
export async function endToEndEncryptMessage(encryptedEndToEndKey, message) {
    const key = await loadEndToEndKey(encryptedEndToEndKey);

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, tagLength: 128, additionalData: authenticatedData },
        key,
        encoder.encode(message)
    );

    const iv64 = toBase64(iv);
    const encrypted64 = toBase64(encrypted);

    return `a256gcm/${iv64}/${encrypted64}`;
}
