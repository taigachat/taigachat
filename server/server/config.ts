import { z } from 'zod'
import "https://deno.land/std@0.186.0/dotenv/load.ts";

const defaultDataPath = `${Deno.env.get('XDG_DATA_HOME')||
                          Deno.env.get('LOCALAPPDATA') ||
                          './data'}/TaigaChatServer`

const defaultMediaWorkerPath = Deno.env.get('container') === 'flatpak'
                             ? '/app/bin/media-worker-sfu'
                             : Deno.build.os === 'windows'
                             ? './media-worker/target/debug/media-worker-windows.exe'
                             : './media-worker/sfu/target/debug/media-worker-sfu.exe'

let rtcpFeedback = z.object({
    type: z.string(),
    parameter: z.string()
})

export function parseQuotedStrings(input: string): string[] {
    const result = []
    let i = 0;
    let length = input.length
    let current = ''

    // There is a lot of indentation here. But there is probably
    // no other _clean_ way unless functions are introduced.
    while (i < length) {
        const ch = input.charAt(i++)
        switch (ch) {
            case '"':
                while (i < length) {
                    const ch = input.charAt(i++)
                    if (ch === '\\') {
                        const ch = input.charAt(i++)
                        current += ch
                    } else if (ch === '"') {
                        break
                    } else {
                        current += ch
                    }
                }
                break
            case ' ':
                result.push(current)
                current = ''
                break
            default:
                current += ch
        }
    }
    if (current !== '') {
        result.push(current)
    }
    return result
}

let configType = z.object({
    httpsPort: z.number().nullable(),
    httpPort: z.number().nullable(),
    publicIP: z.string(),
    serverID: z.string(),
    adams: z.array(z.string()),
    certFile: z.string(),
    keyFile: z.string(),
    dataPath: z.string(),
    iceServers: z.array(z.string()),
    logModules: z.array(z.string()),
    s3PublicURL: z.string(),
    s3API: z.string(),
    s3AccessKey: z.string(),
    s3SecretKey: z.string(),
    s3ServerStart: z.array(z.string()),

    mediaWorker: z.object({
        domainSocket: z.string(),
        announceIP: z.string(),
        path: z.string(),
        workerCount: z.number(),
        worker: z.object({
            rtcMinPort: z.number(),
            rtcMaxPort: z.number(),
            logLevel: z.string(),
            logTags: z.array(z.string()),
        }),
        router: z.object({
            mediaCodecs: z.array(z.object({
                kind: z.enum(['audio', 'video']),
                mimeType: z.string(),
                preferredPayloadType: z.number().int().lt(256).optional(),
                clockRate: z.number().int().gt(0),
                channels: z.number().int().gt(0).lt(256).optional(),
                parameters: z.record(z.string().or(z.number())).default({}),
                rtcpFeedback: z.array(rtcpFeedback).default([])
            }))
        }),
        /*
        TODO: Add bitrate option and initialAvailableOutgoingBitrate
        "webRtcTransport": {
            "maxIncomingBitrate": 1500000,
            "initialAvailableOutgoingBitrate": 1000000
        }
        */
    })
})
type ConfigType = z.infer<typeof configType>

const reasonableMediaCodecs = [
    {
        "kind": "audio",
        "mimeType": "audio/opus",
        "clockRate": 48000,
        "channels": 2
    },
    {
        "kind": "video",
        "mimeType": "video/VP8",
        "clockRate": 90000,
        "parameters": {
            "x-google-start-bitrate": 1000
        }
    }
]

const envPrefix = 'TAIGACHAT_'
const recognizedOptions = new Set()
function configString<T>(name: string, defaultValue: T) {
    const fullName = envPrefix + name
    recognizedOptions.add(fullName)
    const value = Deno.env.get(fullName)
    return value === undefined ? defaultValue : value
}
function numberError(fullName: string): number {
    throw new Error(`supplied value ${envPrefix}${fullName} is not a number`)
}
const numberRegex = /^\d*(\.\d+)?$/
function configNumber<T>(name: string, defaultValue: T): number | T {
    const value = configString(name, defaultValue)
    return (value !== defaultValue && typeof value === 'string')
        ? (value.match(numberRegex)
            ? parseInt(value)
            : numberError(name))
        : defaultValue
}
function configStringArray(name: string) {
    return configString(name, '').split(';')
}
function configJson<T>(name: string, defaultValue: T) {
    return JSON.parse(configString(name, JSON.stringify(defaultValue)))
}

const configStore: ConfigType = {
    httpPort:        configNumber('HTTP_PORT', null), // TODO: Can we use undefined instead?
    httpsPort:       configNumber('HTTPS_PORT', null),
    publicIP:        configString('PUBLIC_IP', '127.0.0.1'), // TODO: It should probably be renamed to URL and then be used in the nonce challenge
    serverID:        configString('SERVER_ID', 'NO-ID'),
    certFile:        configString('CERT_FILE', ''),
    keyFile:         configString('KEY_FILE', ''),
    dataPath:        configString('DATA_PATH', defaultDataPath),
    adams:           configStringArray('ADAMS'),
    iceServers:      configStringArray('ICE_SERVERS'),
    logModules:      configStringArray('LOG_MODULES'),
    s3PublicURL:     configString('S3_PUBLIC_URL', 'http://localhost:9000'),
    s3API:           configString('S3_API', ''),
    s3AccessKey:     configString('S3_ACCESS_KEY', ''),
    s3SecretKey:     configString('S3_SECRET_KEY', ''),
    s3ServerStart:    parseQuotedStrings(configString('S3_SERVER_START', './minio server ./s3data')),
    mediaWorker: { // TODO: rename to mediaWorker
        domainSocket: configString('MEDIA_WORKER_DOMAIN_SOCKET', ''),
        announceIP:   configString('MEDIA_WORKER_ANNOUNCE_IP', ''),
        path:         configString('MEDIA_WORKER_PATH', defaultMediaWorkerPath), // TODO: Validate path
        workerCount:  configNumber('MEDIA_WORKER_COUNT', navigator.hardwareConcurrency),
        worker: {
            rtcMinPort: configNumber('MEDIA_WORKER_RTC_MIN_PORT', 10000),
            rtcMaxPort: configNumber('MEDIA_WORKER_RTC_MAX_PORT', 59999),
            logLevel:   configString('MEDIA_WORKER_LOG_LEVEL', 'warn'),
            logTags:    configStringArray('MEDIA_WORKER_LOG_TAGS')
        },
        router: {
            mediaCodecs: configJson('MEDIA_WORKER_CODECS', reasonableMediaCodecs)
        }
    },
}
// TODO: Detect unrecognized config variables?
for(const key in Deno.env.toObject()) {
    if (key.startsWith(envPrefix)) {
        if (!recognizedOptions.has(key)) {
            console.warn('unrecognized environment variable:', key)
        }
    }
}


// TODO: Only strictly necessary for the configJson call
const config = configType.parse(configStore)
export default config
