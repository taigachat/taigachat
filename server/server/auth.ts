'use strict'

import { X509Certificates, PublicKey } from '@peculiar/x509'
import { fromBase64, toBase64 } from 'encoding_schemes'
import { verifyX509Chain, exportAsSHA512 } from './x509_chains.ts'

import { crypto } from "https://deno.land/std@0.127.0/crypto/mod.ts";

export function randomString(): string {
    const array = new Uint8Array(32)
    return toBase64(crypto.getRandomValues(array))
}

export function randomNonce(ip: string, name: string): string {
    return `nonce ${Date.now()} ${randomString()} ${ip} ${name}`
}

const encoder = new TextEncoder()
function decodeUtf8(data: string) {
    return encoder.encode(data)
}

async function verifyBuffer(algorithm: RsaHashedImportParams, data: BufferSource, signature: string, key: PublicKey) {
    //console.log('verify', data, 'using', signature, 'key', key)
    if (data == undefined || signature == undefined || signature === '' || key == undefined || data.byteLength === 0) {
        return false
    }
    const jwk = await exportAsSHA512(key, 'verify')
    //console.dir(jwk)
    let signatureBuffer: ArrayBuffer
    try {
        signatureBuffer = fromBase64(signature)
    } catch (_e) {
        return false
    }
    return await crypto.subtle.verify(
        algorithm,
        jwk,
        signatureBuffer,
        data
    )
}

export async function verifyNonce(algorithm: RsaHashedImportParams, chain: X509Certificates, adams: string[], nonce: string, nonceSignature: string) {
    const result = await verifyX509Chain(chain/*, adams*/)
    //console.log(nonce, nonceSignature)
    if (!(await verifyBuffer(algorithm,
                             decodeUtf8(nonce),
                             nonceSignature,
                             result.publicSessionKey))
    ) {
        throw 'invalid nonce'
    }

    return result
}

export async function unitTest() {
    // TODO: Do some unit tests here again!
    // TODO: Should probably be writtein in a seperate test file
}
