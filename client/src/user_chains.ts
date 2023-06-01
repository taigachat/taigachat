// TODO: Rename to cryptography.ts

export { verifyX509Chain } from './x509_chains'
import { parseX509Chain } from './x509_chains'
import { toBase64, fromBase64, fromUtf8, toUtf8 } from 'encoding_schemes'
import { X509CertificateGenerator, PemConverter, X509Certificate, KeyUsagesExtension, KeyUsageFlags, BasicConstraintsExtension } from '@peculiar/x509'
import { DEFAULT_SIGN_ALGORITHM } from './schema'
import { mutableClone, Immutable } from './immutable'

export const STANDARD_KEY_ENCRYPTION_METHOD = 'v0 family-salt pbkdf2 100000 sha 256 aes-gcm 128' // TODO: There is probably a standardized system for this.

export async function importPKCS8PEM(pem: string): Promise<JsonWebKey> {
    // Make sure PEM contains PKCS8 and not PKCS1.
    const der = PemConverter.decodeFirst(pem)
    const fourth = new Uint8Array(der)[3]
    if (fourth == 0x2B) {
        // This is done to prevent common mistakes while exporting data.
        throw 'PEM contained a PKCS1 and not the required PKCS8'
    }
    const key = await crypto.subtle.importKey('pkcs8', der, DEFAULT_SIGN_ALGORITHM, true, ['sign'])
    const jwk = await crypto.subtle.exportKey('jwk', key)
    return jwk
}

export async function exportKeyJWK(key: CryptoKey): Promise<JsonWebKey> {
    const jwk = await crypto.subtle.exportKey('jwk', key)
    return jwk
}

export async function exportKeySPKI(key: CryptoKey): Promise<string> {
    const ab = await crypto.subtle.exportKey('spki', key)
    return PemConverter.encode(ab, 'PUBLIC KEY')
}

function createRandomSerial() {
    let hexRef = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];
    let output = ''
    for(let i = 0; i < 16; i++) { 
        output += hexRef[Math.floor(Math.random() * 16)]
    }
    return output
}
; (window as any).debugCreateRandomSerial = createRandomSerial

// TODO: Do more tools other than XCA use this constant?
const UNDEFINED_EXPIRY = 253402300799000

function createGenericCertificate(subject: string, publicKey: CryptoKey, signingKey: CryptoKey) {
    return X509CertificateGenerator.create({  
        serialNumber: createRandomSerial(),
        subject,
        signingAlgorithm: DEFAULT_SIGN_ALGORITHM,
        publicKey,
        signingKey,
        notBefore: new Date(),
        notAfter: new Date(UNDEFINED_EXPIRY),
        extensions: [
            new BasicConstraintsExtension(true),
            new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
        ]
    })
}

export function createSessionCertificate(publicKey: CryptoKey, signingKey: CryptoKey) {
    return createGenericCertificate('CN=Session', publicKey, signingKey) // TODO: Add /CN
}

export function createUserCertificate(publicKey: CryptoKey, signingKey: CryptoKey) {
    return createGenericCertificate('CN=User', publicKey, signingKey)
}

export function appendCertificate(chainUnparsed: string, cert: X509Certificate) {
    const chain = parseX509Chain(chainUnparsed)
    chain.unshift(cert)
    return chain.export()
}

export function importKeyJWK(key: Immutable<JsonWebKey>, keyUsage: KeyUsage, extract = false) {
    // TODO: Instead of constantly reimporting this key.
    // We can just store it in the indexedDB.

    // TODO: Skip the mutableClone if we don't have to change key_ops!
    // TODO: Maybe changing key_ops at all is a sign of bad code...
    const jwk = mutableClone(key)
    jwk.key_ops = ['sign', 'verify']
    console.log(jwk)
    return crypto.subtle.importKey(
        'jwk',
        jwk,
        DEFAULT_SIGN_ALGORITHM,
        extract,
        [keyUsage]
    )
}

export async function signNonce(privateKey: JsonWebKey, nonce: string) {
    if (!nonce.startsWith('nonce ')) {
        // Refuse to sign anything that isn't a nonce!
        // Otherwise signNonce becomes an unwanted beacon...
        return ''
    }
    console.log(nonce)
    // TODO: Parse nonce and check public IP, timestamp, server name, etc...
    // TODO: Make sure public IP and server name has not changed.
    // TODO: Make sure timestamp is reasonable.

    const importedKey = await importKeyJWK(privateKey, 'sign')

    return toBase64(
        await crypto.subtle.sign(
            DEFAULT_SIGN_ALGORITHM,
            importedKey,
            fromUtf8(nonce)
        )
    )
}

const CENTRAL_ENCRYPTION_SALT = 'Henrik Margo Alexander Tanja Johan'
const CENTRAL_HASHING_SALT = 'I like elephants'

async function createWrappingBits(password: string, salt: string) {
    const derivingKey = await crypto.subtle.importKey(
        "raw",
        fromUtf8(password),
        {name: "PBKDF2"},
        false,
        ['deriveBits', 'deriveKey']
    )
    return await window.crypto.subtle.deriveBits({
        name: "PBKDF2",
        salt: fromUtf8(salt),
        iterations: 100000,
        hash: "SHA-256"
    }, derivingKey, 256)
}

export async function hashPassword(password: string): Promise<string> {
    return toBase64(await createWrappingBits(password, CENTRAL_HASHING_SALT))
}

export async function randomIV() {
    return crypto.getRandomValues(new Uint8Array(12));
}

export async function encryptKey(privateKey: JsonWebKey, password: string, iv: ArrayBuffer) {
    const wrappingKey = await crypto.subtle.importKey('raw', await createWrappingBits(password, CENTRAL_ENCRYPTION_SALT), {
        name: 'AES-GCM',
        length: 256
    }, false, ['encrypt'])
    return toBase64(await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        tagLength: 128,
    }, wrappingKey, fromUtf8(JSON.stringify(privateKey))))
}

export async function decryptKey(wrappedKey: string, password: string, iv: string): Promise<JsonWebKey> {
    const wrappingKey = await crypto.subtle.importKey('raw', await createWrappingBits(password, CENTRAL_ENCRYPTION_SALT), {
        name: 'AES-GCM',
        length: 256
    }, false, ['decrypt'])
    return JSON.parse(toUtf8(await crypto.subtle.decrypt({
        name: 'AES-GCM',
        tagLength: 128,
        iv: fromBase64(iv)
    }, wrappingKey, fromBase64(wrappedKey))))
}
