import { z } from "zod";

// TODO: Auto generate the types using Zig. And validate using WASM. Benchmark this approach first. After validation use JSON.parse as that should still be the fastest option.

export const SCHEMA_VERSION = 0;

export const radix64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
export function toRadix64(n: number) {
    if (n < 0) {
        // We return an empty string such that
        // an overflow bug doesn't cause any unwanted
        // security problems. An alternative would be to
        // throw here or use a stricter type system.
        return "";
    }
    if (n === 0) {
        // Since the below while statement terminates
        // if n === 0, we hardcode a value here instead.
        return "0";
    }
    let result = "";
    let bigN = BigInt(n);
    const six = BigInt(6);
    const zero = BigInt(0);
    const mask = BigInt(0b111111);
    while (bigN !== zero) {
        const d = Number(bigN & mask);
        result = radix64[d] + result;
        bigN >>= six;
    }
    return result;
}

const lookup = new Array(256);
for (let i = 0; i < radix64.length; i++) {
    lookup[radix64.charCodeAt(i)] = BigInt(i);
}

const STOP_CHAR1 = ".".charCodeAt(0);
const STOP_CHAR2 = "~".charCodeAt(0);

export function fromRadix64(txt: string, startFrom: number = 0): number {
    if (txt.length === 0) {
        // An empty string signifies either an
        // invalid number or a negative number.
        return -1;
    }
    let result = BigInt(0);
    const six = BigInt(6);
    for (let i = startFrom; i < txt.length; i++) {
        const charCode = txt.charCodeAt(i);
        if (charCode === STOP_CHAR1 || charCode === STOP_CHAR2) {
            if (i === startFrom) {
                // Same as the empty string check above.
                return -1;
            }
            break;
        }
        result <<= six;
        result += lookup[charCode];
    }
    return Number(result);
}

/** SFU Communication **/
const mediaKind = z.enum(["audio", "video"]);

const rtcpFeedback = z.object({
    type: z.string(),
    parameter: z.ostring(),
});

const codecCapability = z.object({
    kind: mediaKind,
    mimeType: z.string(),
    preferredPayloadType: z.onumber(),
    clockRate: z.number(),
    channels: z.onumber(),
    parameters: z.any().optional(), // TODO: investiage possible types
    rtcpFeedback: z.array(rtcpFeedback).optional(),
});

// Make sure to keep this up to date with values defined in mediasoup-client RtpHeaderExtensionUri.
const rtpHeaderExtensionUri = z.enum([
    "urn:ietf:params:rtp-hdrext:sdes:mid",
    "urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
    "urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
    "http://tools.ietf.org/html/draft-ietf-avtext-framemarking-07",
    "urn:ietf:params:rtp-hdrext:framemarking",
    "urn:ietf:params:rtp-hdrext:ssrc-audio-level",
    "urn:3gpp:video-orientation",
    "urn:ietf:params:rtp-hdrext:toffset",
    "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
    "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
    "http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time",
    "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay",
]);

const rtpHeaderExtension = z.object({
    kind: mediaKind,
    uri: rtpHeaderExtensionUri,
    preferredId: z.number(),
    preferredEncrypt: z.oboolean(),
    direction: z.enum(["sendrecv", "sendonly", "recvonly", "inactive"]).optional(),
});

const rtpHeaderExtensionParameters = z.object({
    uri: rtpHeaderExtensionUri,
    id: z.number(),
    encrypt: z.oboolean(),
    parameters: z.any().optional(), // TODO: investiage possible types
});

export const rtpCapabilities = z.object({
    codecs: z.array(codecCapability).optional(),
    headerExtensions: z.array(rtpHeaderExtension).optional(),
});

const dtlsParameters = z.object({
    role: z.enum(["auto", "client", "server"]).optional(),
    fingerprints: z.array(
        z.object({
            algorithm: z.enum(["sha-1", "sha-224", "sha-256", "sha-384", "sha-512"]),
            value: z.string(),
        })
    ),
});

const rtpParameters = z.object({
    mid: z.ostring(),
    codecs: z.array(
        z.object({
            mimeType: z.string(),
            payloadType: z.number(),
            clockRate: z.number(),
            channels: z.onumber(),
            parameters: z.any().optional(), // TODO: investiage possible types
            rtcpFeedback: z.array(rtcpFeedback).optional(),
        })
    ),
    headerExtensions: z.array(rtpHeaderExtensionParameters).optional(),
    encodings: z
        .array(
            z.object({
                ssrc: z.onumber(),
                rid: z.ostring(),
                codecPayloadType: z.onumber(),
                rtx: z.object({ ssrc: z.number() }).optional(),
                dtx: z.oboolean(),
                scalabilityMode: z.ostring(),
                scaleResolutionDownBy: z.onumber(),
                maxBitrate: z.onumber(),
                adaptivePtime: z.oboolean(),
                priority: z.enum(["very-low", "low", "medium", "high"]).optional(),
                networkPriority: z.enum(["very-low", "low", "medium", "high"]).optional(),
            })
        )
        .optional(),
    rtcp: z
        .object({
            cname: z.ostring(),
            reducedSize: z.oboolean(),
            mux: z.oboolean(),
        })
        .optional(),
});

// TransportOptions
const transportOptions = z.object({
    id: z.string(),
    iceParameters: z.object({
        usernameFragment: z.string(),
        password: z.string(),
        iceLite: z.oboolean(),
    }),
    iceCandidates: z.array(
        z.object({
            foundation: z.string(),
            priority: z.number(),
            address: z.string(),
            ip: z.string().default(""), // Has been deprecated, but kept here for completions sake.
            protocol: z.enum(["udp", "tcp"]),
            port: z.number(),
            type: z.enum(["host", "srflx", "prflx", "relay"]),
            tcpType: z.enum(["active", "passive", "so"]).optional(),
        })
    ),
    dtlsParameters,
    sctpParameters: z
        .object({
            port: z.number(),
            OS: z.number(),
            MIS: z.number(),
            maxMessageSize: z.number(),
        })
        .optional(),
    iceServers: z
        .array(
            z.object({
                credential: z.ostring(),
                credentialType: z.literal("password").optional(),
                urls: z.string().or(z.array(z.string())),
                username: z.ostring(),
            })
        )
        .optional(),
    iceTransportPolicy: z.enum(["all", "relay"]).optional(),
    additionalSettings: z.any().optional(), // TODO: explore possible values
    proprietaryConstraints: z.any().optional(), // TODO: explore possible values
    appData: z.record(z.any()).optional(), // TODO: explore possible values
});

export const messageFromSFU = z.object({
    capabilities: rtpCapabilities.optional(),
    newProducers: z
        .array(
            z.object({
                peerID: z.number(),
                producerID: z.string(),
            })
        )
        .optional(),
    consumerClosed: z.ostring(),
    transportCreated: z
        .object({
            errand: z.number(),
            data: transportOptions,
        })
        .optional(),
    transportConnected: z
        .object({
            errand: z.number(),
        })
        .optional(),
    transportProducing: z
        .object({
            errand: z.number(),
            producerID: z.string(),
        })
        .optional(),
    producerConsumed: z
        .object({
            id: z.string(),
            producerID: z.string(),
            kind: mediaKind,
            rtpParameters,
        })
        .optional(),
});
export const sfuToServer = z.tuple([z.number(), z.number(), messageFromSFU]);

export type MessageFromSFU = z.infer<typeof messageFromSFU>;

export const messageToSFU = z.object({
    createTransport: z
        .object({
            rtpCapabilities,
            forceTCP: z.boolean(),
            errand: z.number(),
        })
        .optional(),
    connectTransport: z
        .object({
            dtlsParameters,
            transportID: z.string(),
            errand: z.number(),
        })
        .optional(),
    produceTransport: z
        .object({
            producerTransportID: z.string(),
            kind: mediaKind,
            rtpParameters,
            errand: z.number(),
        })
        .optional(),
    producerClosed: z
        .object({
            producerID: z.string(),
        })
        .optional(),
    consumeProducer: z
        .object({
            rtpCapabilities,
            consumerTransportID: z.string(),
            producerID: z.string(),
        })
        .optional(),
    getProducers: z.object({}).optional(),
});

export type MessageToSFU = z.infer<typeof messageToSFU>;

/** Content Server Stuff **/

export const profileUploadURL = z.object({
    uploadURL: z.string(),
    userID: z.string(),
    profileTimestamp: z.number(),
});
export type ProfileUploadURL = z.infer<typeof profileUploadURL>;

export const messageAttachmentIdempotence = z.object({
    uploadURL: z.string(),
    idempotence: z.string(),
    roomID: z.number(),
    chunkID: z.number(),
    messageIndex: z.number(),
});
export type MessageAttachmentIdempotence = z.infer<typeof messageAttachmentIdempotence>;

const messageAttachment = z.object({
    fileName: z.string(),
    name: z.string(),
    mime: z.string(),
    height: z.onumber(),
});
export type MessageAttachment = z.infer<typeof messageAttachment>;

const message = z.object({
    roomID: z.number(),
    messageIndex: z.number(),
    chunkID: z.number(),
    deleted: z.oboolean(),
    edited: z.oboolean(),
    time: z.number(),
    userID: z.string(),
    content: z.string(),
    encryptedBy: z.ostring(),
    attachment: messageAttachment.optional(),
    hasAttachment: z.oboolean(),
    informs: z.array(z.string()),
});
export type Message = z.infer<typeof message>;

const messageActionAttachment = z.object({
    name: z.string(),
    mime: z.string(),
    height: z.onumber(),
});
export type MessageActionAttachment = z.infer<typeof messageActionAttachment>;

const messageAction = z.object({
    attachment: messageActionAttachment.optional(),
    content: z.string(),
    encryptedBy: z.string(),
    roomID: z.number(),
    informs: z.array(z.string()),
    idempotence: z.string(),
});
export type MessageAction = z.infer<typeof messageAction>;

const role = z.object({
    roleID: z.number(),
    name: z.string(),
    penalty: z.number(),
    defaultRole: z.oboolean(),
    defaultAdminRole: z.oboolean(),
});

export type Role = z.infer<typeof role>;

const rolePermissionState = z.enum(["allowed", "neutral", "denied"]);
export type RolePermissionState = z.infer<typeof rolePermissionState>;

export const ECDSA_IDENTITY_ALGORITHM: EcKeyImportParams = {
    name: "ECDSA",
    namedCurve: "P-384",
};

const mainAuthMethod = z.union([
    z.object({
        expectedAuthID: z.string(),
        ecdsaIdentity: z.object({
            publicKeyRaw: z.string(),
            signedNonce: z.string(),
        }),
    }),
    z.object({
        expectedAuthID: z.string(),
        guest: z.object({
            identifier: z.string(),
        }),
    }),
]);
export type MainAuthMethod = z.infer<typeof mainAuthMethod>;

// TODO: Perhaps these should be renamed ServerSpecificAuths? Or something like that.
// TODO: Or maybe we want both? And if this change is done, then the MainAuth could be renamed.
const extraSecurityMethod = z.union([
    z.object({
        secretPhrase: z.object({
            secret: z.string(),
        }),
    }),
    z.object({
        jwk: z.object({
            // TODO: Add. Maybe?
        }),
    }),
]);
export type ExtraSecurityMethod = z.infer<typeof extraSecurityMethod>;

const combinedAuthMethod = z.object({
    mainIdentifier: mainAuthMethod,
    transferIdentifiers: z.array(mainAuthMethod),
    extraSecurity: z.array(extraSecurityMethod),
});
export type CombinedAuthMethod = z.infer<typeof combinedAuthMethod>;

export const authFailure = z.object({
    attemptType: z.enum(["main", "transfer", "extra"]),
    attempt: z.union([mainAuthMethod, extraSecurityMethod]).optional(),
    error: z.string(),

    // This string must be signed.
    nonce: z.string(),

    // Anonymous logins concatenate against this value in order to predict the userID.
    publicSalt: z.string(),
});
export type AuthFailure = z.infer<typeof authFailure>;

export const actionsData = {
    userIsActive0: z.tuple([]),
    addNotificationToken0: z.tuple([z.string(), z.string()]),
    setVoiceMute0: z.tuple([z.boolean(), z.boolean()]),
    setVoiceDeafen0: z.tuple([z.boolean()]),
    setVoiceTalking0: z.tuple([z.boolean()]),
    sendMessageSFU0: z.tuple([messageToSFU]),
    newChannel0: z.tuple([]),
    deleteChannel0: z.tuple([z.number()]),
    joinChannel0: z.tuple([z.number(), z.boolean(), z.boolean()]),
    setChannelName0: z.tuple([z.number(), z.string()]),
    newRoom0: z.tuple([]),
    newMessage0: z.tuple([messageAction]),
    unveilAttachment0: z.tuple([messageAttachmentIdempotence]),
    deleteMessage0: z.tuple([z.number(), z.number(), z.number()]),
    editMessage0: z.tuple([z.number(), z.number(), z.number(), z.string()]),
    deleteRoom0: z.tuple([z.number()]),
    setRoomName0: z.tuple([z.number(), z.string()]),
    setRoomEncryptedBy0: z.tuple([z.number(), z.string()]),
    setRoomDescription0: z.tuple([z.number(), z.string()]),
    newServerRole0: z.tuple([]),
    giveServerRole0: z.tuple([z.string(), z.number()]),
    revokeServerRole0: z.tuple([z.string(), z.number()]),
    deleteServerRole0: z.tuple([z.number()]),
    setPermissionInDomain0: z.tuple([z.number(), z.string(), z.string(), rolePermissionState]),
    clearPermissionsInDomain0: z.tuple([z.string()]),
    setRoleName0: z.tuple([z.number(), z.string()]),
    swapRolePenalty0: z.tuple([z.number(), z.number()]),
    setServerName0: z.tuple([z.string()]),
    requestProfileUpload0: z.tuple([z.number()]),
    setProfile0: z.tuple([z.number()]),
    acknowledgeUpdates0: z.tuple([z.number(), z.string(), z.boolean()]),
    pong0: z.tuple([]),
};

export type ActionsKey = keyof typeof actionsData;
export type ActionData<T extends ActionsKey> = z.infer<(typeof actionsData)[T]>;

export const actionRequest = z.object({
    args: z.array(z.unknown()),
    auth: combinedAuthMethod.optional(),
});
export type ActionRequest = z.infer<typeof actionRequest>;

const room = z.object({
    roomID: z.number(),
    name: z.string(),
    description: z.string(),
    encryptedBy: z.ostring(),
    chunkCount: z.number(),
});
export type Room = z.infer<typeof room>;

const voiceState = z.object({
    selfMute: z.boolean(),
    selfDeafen: z.boolean(),
    talking: z.boolean(),
    channelID: z.number(),
    userID: z.string(),
    peerID: z.number(),
    connected: z.boolean(),
});
export type VoiceState = z.infer<typeof voiceState>;

const channel = z.object({
    channelID: z.number(),
    name: z.string(),
    //permissions: z.array(role).optional()
});
// TODO: Rename to VoiceChannel again
export type Channel = z.infer<typeof channel>;

const activeChannel = z.object({
    channelID: z.number(),
    connectedUsers: z.array(voiceState),
});
export type ActiveChannel = z.infer<typeof activeChannel>;

const userIdentity = z.union([
    z.object({
        ecdsaIdentity: z.object({
            publicKeyRaw: z.string(),
        }),
    }),
    z.object({
        guest: z.object({
            // No way to prove the identity of SECRET_PHRASE yet
        }),
    }),
]);

/** The publicly advertised identities of a user. */
export type UserIdentity = z.infer<typeof userIdentity>;

const serverUser = z.object({
    userID: z.string(),
    identities: z.array(userIdentity),
    lastSeen: z.number(),
    profileTimestamp: z.number(),
    roles: z.string().regex(/\[[\d,]+\]/), // Sloppy regex for a JSON array of numbers.
    connected: z.number(),
});
export type ServerUser = z.infer<typeof serverUser>;

const domainPermission = z.object({
    roleID: z.number(),
    subdomain: z.string(),
    allowed: z.array(z.string()),
    denied: z.array(z.string()),
});
export type DomainPermission = z.infer<typeof domainPermission>;

const serverInfo = z.object({
    name: z.string(),
});
export type ServerInfo = z.infer<typeof serverInfo>;

// TODO: Remove this suppression someday

serverInfo; // eslint-disable-line @typescript-eslint/no-unused-expressions

const updateObject = z.object({
    path: z.ostring(),
    lastModified: z.number(),
    faddishness: z.number(),
    data: z.undefined(),
    type: z.literal("undefined"),
});
export type UpdateObject = z.infer<typeof updateObject>;

const updateObjectVariants = z.discriminatedUnion("type", [
    updateObject,
    updateObject.extend({
        type: z.literal("message"),
        data: message,
    }),
    updateObject.extend({
        type: z.literal("room"),
        data: room,
    }),
    updateObject.extend({
        type: z.literal("permission"),
        data: domainPermission,
    }),
    updateObject.extend({
        type: z.literal("channel"),
        data: channel,
    }),
    updateObject.extend({
        type: z.literal("activeChannel"),
        data: activeChannel,
    }),
    updateObject.extend({
        type: z.literal("user"),
        data: serverUser,
    }),
    updateObject.extend({
        type: z.literal("role"),
        data: role,
    }),
    updateObject.extend({
        type: z.literal("serverInfo"),
        data: z.object({
            name: z.string(),
        }),
    }),
]);
export type UpdateObjectVariants = z.infer<typeof updateObjectVariants>;

export const updateObjects = z.array(updateObjectVariants);

const definedPermission = z.object({
    title: z.string(),
    scope: z.string(),
});
export type DefinedPermission = z.infer<typeof definedPermission>;

export const serverToClientProvision = z.object({
    definedPermissions: z.record(definedPermission),
    supportedActions: z.array(z.string()),
    attachmentsURL: z.string(),
    profilesURL: z.string(),
    userID: z.string(),
    publicSalt: z.string(),
    // TODO: Add iceServers
});

export type ServerToClientProvision = z.infer<typeof serverToClientProvision>;

export const PROFILE_SIGN_ALGORITHM: EcdsaParams = {
    name: "ECDSA",
    hash: "SHA-384",
};

export const imageEmbeddedProfile = z.object({
    userName: z.string(),

    timestamp: z.number(),
});
export type ImageEmbeddedProfile = z.infer<typeof imageEmbeddedProfile>;
