import { S3Client } from 'https://deno.land/x/s3_lite_client@0.5.0/mod.ts';
import { ServerError } from 'https://deno.land/x/s3_lite_client@0.5.0/errors.ts';
import config from './config.ts'
import { getLog } from './log.ts'
const { info, error } = getLog('s3')

let s3process: Deno.Process
let s3initialized: Promise<void>

// TODO: Handle authentication failure

async function waitForS3() {
    // TODO: Perhaps this function could be improved by someone with more knowledge
    for(let i = 0; i < 25; i++) {
        try {
            await getS3Client().makeRequest({
                method: 'GET',
                bucketName: 'profiles',
                objectName: '?policy',
            })
            return
        } catch (e) {
            if (e instanceof ServerError) {
                if (e.code === 'NoSuchBucket') {
                    return
                }
            } else if (e instanceof TypeError) {
                await new Promise(ok => setTimeout(ok, 100))
                continue
            }
            throw e
        }
    }
    error('could not connect to s3 in time')
}

export function startS3() {
    if (config.s3ServerStart.length === 0) {
        return
    }
    if (config.s3SecretKey === '' || config.s3AccessKey === '') {
        error('cannot start s3 due to missing s3SecretKey or s3AccessKey')
        return
    }
    info("starting s3 server")
    const process = Deno.run({
        cmd: config.s3ServerStart,
        env: {
            MINIO_ROOT_USER: config.s3AccessKey,
            MINIO_ROOT_PASSWORD: config.s3SecretKey,
        }
    })
    s3process = process
    s3initialized = waitForS3()
}

function urlToS3Client(url: URL): S3Client {
    const useSSL = url.protocol === 'https:'
    const fallbackPort = useSSL ? '443' : '80'
    return new S3Client({
        endPoint: url.hostname,
        port: parseInt(url.port || fallbackPort),
        useSSL,
        region: '',
        pathStyle: true,
        accessKey: config.s3AccessKey,
        secretKey: config.s3SecretKey,
    })
}

let s3signing: S3Client|undefined

function presignedS3(): S3Client {
    if (s3signing !== undefined) {
        return s3signing
    }

    if (config.s3PublicURL.endsWith('/')) {
        throw new Error('s3PublicURL should not end with \'/\'')
    }

    let url = new URL(config.s3PublicURL)
    s3signing = urlToS3Client(url)
    return s3signing
}


let s3client: S3Client|undefined

function getS3Client(): S3Client {
    if (s3client !== undefined) {
        return s3client
    }

    if (config.s3PublicURL.endsWith('/')) {
        throw new Error('s3PublicURL should not end with \'/\'')
    }

    if (config.s3API.endsWith('/')) {
        throw new Error('s3API shold not end with \'/\'')
    }

    let url = new URL(config.s3API || config.s3PublicURL)
    s3client = urlToS3Client(url)
    return s3client
}

type Methods = 'GET' | 'PUT' | 'HEAD' | 'DELETE'
export async function presignS3URL(method: Methods, bucketName: string, objectName: string, expirySeconds: number, parameters?: Record<string, string>): Promise<string> {
    const urlString = await presignedS3().getPresignedUrl(method, objectName, {
        bucketName,
        expirySeconds,
        parameters
    })

    // If we wrote the S3 lib from scratch, this hack wouldn't be required.
    // We do this to support path redirects for the nginx proxy.
    const url = new URL(urlString)
    return `${config.s3PublicURL}${url.pathname}${url.search}`
}

export function getBucketURL(bucket: string) {
    return `${config.s3PublicURL}/${bucket}`
}

interface S3PolicyStatement {
    Sid: string,
    Effect: string,
    Principal: Record<string, string[]>,
    Action: string[],
    Resource: string[],
}
interface S3Policy {
    Version: string,
    Statement: S3PolicyStatement[]
}

async function sendBucketPolicy(bucketName: string, policy: S3Policy) {
    await getS3Client().makeRequest({
        method: 'PUT',
        bucketName,
        statusCode: 204,
        objectName: '?policy',
        payload: JSON.stringify(policy)
    })
}

async function createBucket(bucketName: string, policy: S3Policy) {
    /*const payload = {
        CreateBucketConfiguration: [
            {
                _attr: {
                    xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/',
                }
            }
        ]
    }*/
    try {
        await getS3Client().makeRequest({
            method: 'GET',
            bucketName,
            objectName: '?policy',
        })
        // We will throw in the above function if either
        // 1. the bucket does not exist
        // 2. the bucket exists but does not have a policy yet.

        info(`bucket '${bucketName}' already exists and has a policy - no changes required`)
    } catch (e) {
        if (!(e instanceof ServerError)) {
            throw e
        }
        if (e.code === 'NoSuchBucket') {
            await getS3Client().makeRequest({
                method: 'PUT',
                bucketName,
                objectName: '',
                payload: ''
            })
            await sendBucketPolicy(bucketName, policy)
        } else if (e.code === 'NoSuchBucketPolicy') {
            await sendBucketPolicy(bucketName, policy)
        } else {
            throw e
        }
    }
}

export async function createBuckets() {
    await s3initialized
    const publicReadPolicy = (bucketName: string): S3Policy => ({
        Version: '2012-10-17',
        Statement: [
            {
                Sid: 'PublicRead',
                Effect: 'Allow',
                Principal: {
                    AWS: [
                        '*'
                    ]
                },
                Action: [
                    's3:GetObject'
                ],
                Resource: [
                    `arn:aws:s3:::${bucketName}/*`
                ]
            }
        ]
    })
    await createBucket('attachments', publicReadPolicy('attachments'))
    await createBucket('profiles', publicReadPolicy('profiles'))
}
