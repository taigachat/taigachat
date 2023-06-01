import { DEFAULT_SIGN_ALGORITHM } from './schema'

let keyPairPromise: Promise<CryptoKeyPair>|undefined = undefined

export function prepareKeyPair() {
    if (keyPairPromise) {
        // Already generating
        return
    }
    //console.log('prepareKeyPair() called')

    // TODO: Check for secure context somewhere.
    // can be overriden in firefox using about:config => dom.securecontext.allowlist

    keyPairPromise = crypto.subtle.generateKey(
        {
            ...DEFAULT_SIGN_ALGORITHM,
            modulusLength: 4096, // TODO: Use higher modulus length during release!!!
            publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // TODO: In theory e=3 could be used here.
        },
        true,
        ['sign', 'verify']
    )
}

export async function newKeyPair() {
    // Make sure that a key is being prepared first.
    prepareKeyPair()

    // Then steal it to make sure we don't double reference it.
    const promise = keyPairPromise!
    keyPairPromise = undefined

    //console.log('newKeyPair() called')
    //await new Promise(ok => setTimeout(ok, 1000))

    return await promise
}
