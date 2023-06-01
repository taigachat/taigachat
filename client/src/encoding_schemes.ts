const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const lookup = new Uint8Array(256)
for (var i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i
}

// This is to support encoding of non-web-safe base64
lookup['+'.charCodeAt(0)] = 62
lookup['/'.charCodeAt(0)] = 63

export function toBase64(arraybuffer: ArrayBuffer): string {
    const bytes = new Uint8Array(arraybuffer)
    const length = bytes.length

    let base64 = ''
    for (let i = 0; i < length; i += 3) {
        base64 += chars[(bytes[i] as number) >> 2]
        base64 += chars[(((bytes[i] as number) & 3) << 4) | ((bytes[i + 1] as number) >> 4)]
        base64 += chars[(((bytes[i + 1] as number) & 15) << 2) | ((bytes[i + 2] as number) >> 6)]
        base64 += chars[(bytes[i + 2] as number) & 63]
    }

    // Remove useless padding.
    if (length % 3 === 2) {
        base64 = base64.substring(0, base64.length - 1)
    } else if (length % 3 === 1) {
        base64 = base64.substring(0, base64.length - 2)
    }

    return base64
}

// TODO: Write unit-tests for these functions since clearly I am too weak to implement these properly.

export function fromBase64(base64: string): ArrayBuffer {
    let bufferLength = Math.floor(base64.length * 0.75)

    const arraybuffer = new ArrayBuffer(bufferLength)
    const bytes = new Uint8Array(arraybuffer)

    let p = 0
    const length = base64.length
    for (let i = 0; i < length; i += 4) {
        const encoded1 = lookup[base64.charCodeAt(i)]     as number
        const encoded2 = lookup[base64.charCodeAt(i + 1)] as number
        const encoded3 = lookup[base64.charCodeAt(i + 2)] as number
        const encoded4 = lookup[base64.charCodeAt(i + 3)] as number

        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4)
        bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2)
        bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63)
    }

    return arraybuffer
}

export function fromUtf8(s: string): ArrayBuffer {
    // TODO: Polyfill TextEncoder
    const encoder = new TextEncoder()
    return encoder.encode(s)
}

export function toUtf8(a: ArrayBuffer): string {
    // TODO: Polyfill TextEncoder
    const decoder = new TextDecoder()
    return decoder.decode(a)
}


export function randomBase64(length: number): string {
    let result = ''
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)]
    }
    return result
}

; (window as any).debugToBase64 = toBase64
; (window as any).debugFromBase64 = fromBase64
