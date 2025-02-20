import { z } from "zod";
import { join } from "path";
import { existsSync } from "fs";

if (existsSync(".env")) {
    process.loadEnvFile();
}

const defaultDataPath =
    process.platform === "win32"
        ? join(process.env["LOCALAPPDATA"] || ".\\data", "TaigaChatServer")
        : process.env["XDG_DATA_HOME"]
          ? join(process.env["XDG_DATA_HOME"] || "", "TaigaChatServer")
          : join(process.env["HOME"] || "./data", ".local", "share", "TaigaChatServer");

const defaultS3Path = join(defaultDataPath, "S3Data");

const defaultMediaWorkerPath =
    process.platform === "win32"
        ? "..\\MediaWorker\\target\\release\\media-worker-windows.exe"
        : "../MediaWorker/sfu/target/release/media-worker-sfu.exe";

let rtcpFeedback = z.object({
    type: z.string(),
    parameter: z.string(),
});

/**
 * @param {string} input
 * @param {string[]} emptyDefault
 * @returns {string[]}
 */
export function parseQuotedStrings(input, emptyDefault = []) {
    const result = [];
    let i = 0;
    let length = input.length;
    let current = "";

    // There is a lot of indentation here. But there is probably
    // no other _clean_ way unless functions are introduced.
    while (i < length) {
        const ch = input.charAt(i++);
        switch (ch) {
            case '"':
                while (i < length) {
                    const ch = input.charAt(i++);
                    if (ch === "\\") {
                        const ch = input.charAt(i++);
                        current += ch;
                    } else if (ch === '"') {
                        break;
                    } else {
                        current += ch;
                    }
                }
                break;
            case " ":
                result.push(current);
                current = "";
                break;
            default:
                current += ch;
        }
    }
    if (current !== "") {
        result.push(current);
    }

    if (result.length === 0) {
        return emptyDefault;
    }

    return result;
}

const mediaCodecs = z.array(
    z.object({
        kind: z.enum(["audio", "video"]),
        mimeType: z.string(),
        preferredPayloadType: z.number().int().lt(256).optional(),
        clockRate: z.number().int().gt(0),
        channels: z.number().int().gt(0).lt(256).optional(),
        parameters: z.record(z.string().or(z.number())).default({}),
        rtcpFeedback: z.array(rtcpFeedback).default([]),
    })
);

/** @type {z.infer<typeof mediaCodecs>} */
const reasonableMediaCodecs = [
    {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
        rtcpFeedback: [],
        parameters: {},
    },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {
            "x-google-start-bitrate": 1000,
        },
        rtcpFeedback: [],
    },
];

const envPrefix = "TAIGACHAT_SERVER_";
const recognizedOptions = new Set();

// TODO: Add descriptions to each config env variable so that one can probe it.

/**
 * @param {string} name
 * @param {T} defaultValue
 * @template T
 */
function configString(name, defaultValue) {
    const fullName = envPrefix + name;
    recognizedOptions.add(fullName);
    const value = process.env[fullName];
    return value === undefined ? defaultValue : value;
}

/**
 * @param {string} fullName
 * @returns {number}
 */
function numberError(fullName) {
    throw new Error(`supplied value ${envPrefix}${fullName} is not a number`);
}

const numberRegex = /^\d*(\.\d+)?$/;

/**
 * @param {string} name
 * @param {T} defaultValue
 * @returns {number | T}
 * @template T
 */
function configNumber(name, defaultValue) {
    const value = configString(name, defaultValue);
    return value !== defaultValue && typeof value === "string"
        ? value.match(numberRegex)
            ? parseInt(value)
            : numberError(name)
        : defaultValue;
}

/**
 * @param {string} name
 * @param {string} defaultValue
 */
function configStringArray(name, defaultValue = "") {
    return configString(name, defaultValue).split(";");
}

/**
 * @param {T} zodParser
 * @param {string} name
 * @param {z.infer<T>} defaultValue
 * @returns z.infer<T>
 * @template {z.ZodTypeAny} T
 */
function configJson(zodParser, name, defaultValue) {
    return zodParser.parse(JSON.parse(configString(name, JSON.stringify(defaultValue))));
}

const defaultOkLoginMethods = "ecdsaIdentity";

const dataPath = configString("DATA_PATH", defaultDataPath);
const config = {
    dataPath,

    // Disconnect the client if ping fails after N miliseconds.
    connectionTimeout: configNumber("CONNECTION_TIMEOUT", 1000 * 45),

    // How many times to
    pingIntervalSplit: Math.max(1, configNumber("PING_INTERVAL_SPLIT", 4)),
    httpPort: configNumber("HTTP_PORT", undefined),
    httpsPort: configNumber("HTTPS_PORT", undefined),
    unixSocket: configString("UNIX_SOCKET", undefined),
    publicURL: configString("PUBLIC_URL", "http://127.0.0.1:9000"), // TODO: It should probably be renamed to URL and then be used in the nonce challenge
    serverID: configString("SERVER_ID", "NO-ID"),
    certFile: configString("CERT_FILE", ""),
    keyFile: configString("KEY_FILE", ""),
    adams: configStringArray("ADAMS"),
    iceServers: configStringArray("ICE_SERVERS"),
    logModules: configStringArray("LOG_MODULES"),
    okLoginMethods: configStringArray("OK_LOGIN_METHODS", defaultOkLoginMethods),
    s3PublicURL: configString("S3_PUBLIC_URL", "http://localhost:9000"),
    s3API: configString("S3_API", ""),
    s3AccessKey: configString("S3_ACCESS_KEY", ""),
    s3SecretKey: configString("S3_SECRET_KEY", ""),
    s3Region: configString("S3_REGION", "us-east-1"),
    s3ServerStart: parseQuotedStrings(configString("S3_SERVER_START", ""), [
        "./minio",
        "server",
        defaultS3Path,
    ]),
    mediaWorker: {
        domainSocket: configString("MEDIA_WORKER_UNIX_SOCKET", ""),
        announceIP: configString("MEDIA_WORKER_ANNOUNCE_IP", ""),
        path: configString("MEDIA_WORKER_PATH", defaultMediaWorkerPath), // TODO: Validate path
        workerCount: configNumber("MEDIA_WORKER_COUNT", navigator.hardwareConcurrency),
        worker: {
            rtcMinPort: configNumber("MEDIA_WORKER_RTC_MIN_PORT", 10000),
            rtcMaxPort: configNumber("MEDIA_WORKER_RTC_MAX_PORT", 59999),
            logLevel: configString("MEDIA_WORKER_LOG_LEVEL", "warn"),
            logTags: configStringArray("MEDIA_WORKER_LOG_TAGS"),
        },
        router: {
            // TODO: mediaCodecs are not even sent, should we remove the code for json parsing?
            mediaCodecs: configJson(mediaCodecs, "MEDIA_WORKER_CODECS", reasonableMediaCodecs),
        },

        /*
        TODO: Add bitrate option and initialAvailableOutgoingBitrate
        "webRtcTransport": {
            "maxIncomingBitrate": 1500000,
            "initialAvailableOutgoingBitrate": 1000000
        }
        */
    },
    secret: configString("SECRET", ""),
};

for (const key in process.env) {
    if (key.startsWith(envPrefix) && !recognizedOptions.has(key)) {
        console.warn("unrecognized environment variable:", key);
    }
}

export default config;
