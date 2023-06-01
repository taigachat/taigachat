import { crypto } from 'https://deno.land/std@0.127.0/crypto/mod.ts'
import { toBase64 } from 'encoding_schemes'
import { presignS3URL } from './s3.ts'

export function randomAttachmentPrefix(): string {
    const array = new Uint8Array(12)
    return toBase64(crypto.getRandomValues(array))
}

export function getAttachmentUpload(name: string): Promise<string> {
    // TODO: secure the name
    return presignS3URL('PUT', 'attachments', name,
                        60 * 60 * 24)
}

export function getProfileUpload(userID: string, profileTimestamp: number): Promise<string> {
    return presignS3URL('PUT', 'profiles', `${userID}/${profileTimestamp}.png`,
                        60 * 60)
}
