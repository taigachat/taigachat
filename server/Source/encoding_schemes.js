/**
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function fromBase64(base64) {
    return Buffer.from(base64, "base64url");
}

/**
 * @param {ArrayBuffer} arraybuffer
 * @returns {string}
 */
export function toBase64(arraybuffer) {
    return Buffer.from(arraybuffer).toString("base64url");
}
