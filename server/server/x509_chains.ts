// This code is shared with the JavaScript implementation of the server.

import { X509Certificate, X509Certificates, PublicKey, PemConverter } from '@peculiar/x509'
import { toBase64 } from 'encoding_schemes'

/** 
 * This function will change the hash to SHA-512 and 
 * export the key as normal 
 */
export function exportAsSHA512(key: PublicKey, usage: KeyUsage) {
    return key.export({
        ...key.algorithm,
        hash: 'SHA-512',
    }, [usage])
}

export function importPKCS7(from: Uint8Array) {
    return new X509Certificates(from)
}

function complainMissMatch(v: string, a?: string, b?: string) {
    console.log(`key ${v}-comparison failed:`, [a, b])
}
const KEY_MISSMATCH = 'public key from chain and private key does not match'
export async function ensurePrivateMatchesPublicKey(a: JsonWebKey, b: JsonWebKey) {
    if (a.alg !== b.alg) {
        complainMissMatch('alg', a.alg, b.alg)
        throw KEY_MISSMATCH
    }
    if (a.kty !== b.kty) {
        complainMissMatch('kty', a.kty, b.kty)
        throw KEY_MISSMATCH
    }
    if (a.n !== b.n) {
        complainMissMatch('n', a.n, b.n)
        throw KEY_MISSMATCH
    }
    if (a.e !== b.e) {
        complainMissMatch('e', a.e, b.e)
        throw KEY_MISSMATCH
    }
}

async function deriveUserID(publicUserKey: PublicKey) {
    return toBase64(await publicUserKey.getThumbprint('SHA-512'))
}

export function loadCertificatesFromMultiplePEM(from: string) {
    if (typeof from !== 'string' || !from.startsWith('-----')) {
        throw 'please provide PEM data'
    }
    const certsDer = PemConverter.decode(from)
    if (certsDer.length < 2) {
        throw 'input did not contain enough certificates to qualify as a chain'
    }
    const certs = certsDer.map(der => new X509Certificate(der))
    return new X509Certificates(certs) 
}

/**
 * @throws {string}
 */
export function parseX509Chain(from: string): X509Certificates {
    if (typeof from !== 'string') {
        throw 'invalid x509 chain'
    }
    
    return new X509Certificates(from)
}

/**
 * Check if a chain of x509 certificates are coherent.
 * @throws {string}
 */
export async function verifyX509Chain(certs: X509Certificates) {
    //console.log('verify:', certs.toString('text'))

    if (certs.length < 1) {
        throw 'certificate chain is too short'
    }
    const lastCert = certs[certs.length - 1]!
    if (!lastCert.isSelfSigned()) {
        throw 'root certificate is not self-signed'
    }
    // TODO: Check if the root certificate is recognized

    let key = lastCert.publicKey
    let publicUserKey = undefined
    let publicSessionKey = undefined
    for(let i = certs.length - 2; i >= 0; i--) {
        const cert = certs[i]!
        if (!(await cert.verify({ publicKey: key }))) {
            throw 'invalid signature'
        }
        // TODO: Perhaps check the issuer serial here despite it not strictly being necessary?
        key = cert.publicKey
        if (cert.subject === 'CN=Session') {
            publicSessionKey = key
        } else if (cert.subject === 'CN=User') {
            publicSessionKey = key
            publicUserKey = key
        } else {
            console.error('subject:', cert.subject)
            throw 'bad certificate subject'
        }
    }

    if (publicUserKey === undefined) {
        throw 'no user certificate'
    }
    if (publicSessionKey === undefined) {
        throw new Error('unreachable')
    }

    return {
        userID: await deriveUserID(publicUserKey),
        publicUserKey,
        publicSessionKey,
    }
}


