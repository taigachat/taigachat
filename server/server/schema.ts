import { z } from 'zod'

export const SCHEMA_VERSION = 0

export const radix64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'

/** SFU Communication **/
const mediaKind = z.enum(['audio', 'video'])

const rtcpFeedback = z.object({
    type: z.string(),
    parameter: z.string().optional(),
})

const codecCapability = z.object({
    kind: mediaKind,
    mimeType: z.string(),
    preferredPayloadType: z.number().optional(),
    clockRate: z.number(),
    channels: z.number().optional(),
    parameters: z.any().optional(), // TODO: investiage possible types
    rtcpFeedback: z.array(rtcpFeedback).optional(),
})

const rtpHeaderExtension = z.object({
    kind: mediaKind,
    uri: z.string(),
    preferredId: z.number(),
    preferredEncrypt: z.boolean().optional(),
    direction: z.enum(['sendrecv', 'sendonly', 'recvonly', 'inactive']).optional(),
})

const rtpHeaderExtensionParameters = z.object({
    uri: z.string(),
    id: z.number(),
    encrypt: z.boolean().optional(),
    parameters: z.any().optional(), // TODO: investiage possible types
})

export const rtpCapabilities = z.object({
    codecs: z.array(codecCapability).optional(),
    headerExtensions: z.array(rtpHeaderExtension).optional(),
})

const dtlsParameters = z.object({
    role: z.enum(['auto', 'client', 'server']).optional(),
    fingerprints: z.array(z.object({
        algorithm: z.string(),
        value: z.string(),
    })),
})

const rtpParameters = z.object({
    mid: z.string().optional(),
    codecs: z.array(z.object({
        mimeType: z.string(),
        payloadType: z.number(),
        clockRate: z.number(),
        channels: z.number().optional(),
        parameters: z.any().optional(), // TODO: investiage possible types
        rtcpFeedback: z.array(rtcpFeedback).optional(),
    })),
    headerExtensions: z.array(rtpHeaderExtensionParameters).optional(),
    encodings: z.array(z.object({
        ssrc: z.number().optional(),
        rid: z.string().optional(),
        codecPayloadType: z.number().optional(),
        rtx: z.object({ssrc: z.number()}).optional(),
        dtx: z.boolean().optional(),
        scalabilityMode: z.string().optional(),
        scaleResolutionDownBy: z.number().optional(),
        maxBitrate: z.number().optional(),
        adaptivePtime: z.boolean().optional(),
        priority: z.enum(['very-low', 'low', 'medium', 'high']).optional(),
        networkPriority: z.enum(['very-low', 'low', 'medium', 'high']).optional(),
    })).optional(),
    rtcp: z.object({
        cname: z.string().optional(),
        reducedSize: z.boolean().optional(),
        mux: z.boolean().optional(),
    }).optional(),
})

// TransportOptions
const transportOptions = z.object({
        id: z.string(),
        iceParameters: z.object({
            usernameFragment: z.string(),
            password: z.string(),
            iceLite: z.boolean().optional(),
        }),
        iceCandidates: z.array(z.object({
            foundation: z.string(),
            priority: z.number(),
            ip: z.string(),
            protocol: z.enum(['udp', 'tcp']),
            port: z.number(),
            type: z.enum(['host', 'srflx', 'prflx', 'relay']),
            tcpType: z.enum(['active', 'passive', 'so']).optional(),
        })),
        dtlsParameters,
        sctpParameters: z.object({
            port: z.number(),
            OS: z.number(),
            MIS: z.number(),
            maxMessageSize: z.number(),
        }).optional(),
        iceServers: z.array(z.object({
            credential: z.string().optional(),
            credentialType: z.literal('password').optional(),
            urls: z.string().or(z.array(z.string())),
            username: z.string().optional(),
        })).optional(),
        iceTransportPolicy: z.enum(['all', 'relay']).optional(),
        additionalSettings: z.any().optional(), // TODO: explore possible values
        proprietaryConstraints: z.any().optional(), // TODO: explore possible values
        appData: z.record(z.any()).optional(), // TODO: explore possible values
})

export const messageFromSFU = z.object({
    capabilities: rtpCapabilities.optional(),
    newProducers: z.array(z.object({
        peerID: z.number(),
        producerID: z.string()
    })).optional(),
    consumerClosed: z.string().optional(),
    transportCreated: z.object({
        errand: z.number(),
        data: transportOptions,
    }).optional(),
    transportConnected: z.object({
        errand: z.number(),
    }).optional(),
    transportProducing: z.object({
        errand: z.number(),
        producerID: z.string(),
    }).optional(),
    producerConsumed: z.object({
        id: z.string(),
        producerID: z.string(),
        kind: mediaKind,
        rtpParameters,
    }).optional(),
})
export const sfuToServer = z.tuple([z.number(), z.number(), messageFromSFU])

export type MessageFromSFU = z.infer<typeof messageFromSFU>

export const messageToSFU = z.object({
    createTransport: z.object({
        rtpCapabilities,
        forceTCP: z.boolean(),
        errand: z.number(),
    }).optional(),
    connectTransport: z.object({
        dtlsParameters,
        transportID: z.string(),
        errand: z.number(),
    }).optional(),
    produceTransport: z.object({
        producerTransportID: z.string(),
        kind: mediaKind,
        rtpParameters,
        errand: z.number(),
    }).optional(),
    producerClosed: z.object({
        producerID: z.string(),
    }).optional(),
    consumeProducer: z.object({
        rtpCapabilities,
        consumerTransportID: z.string(),
        producerID: z.string(),
    }).optional(),
    getProducers: z.object({}).optional(),
})

export type MessageToSFU = z.infer<typeof messageToSFU>


/** Content Server Stuff **/

export const profileUploadURL = z.object({
    uploadURL: z.string(),
    userID: z.string(),
    profileTimestamp: z.number(),
})
export type ProfileUploadURL = z.infer<typeof profileUploadURL>

export const messageAttachmentIdempotence = z.object({
    uploadURL: z.string(),
    idempotence: z.string(),
    roomID: z.number(),
    chunkID: z.number(),
    messageIndex: z.number(),
})
export type MessageAttachmentIdempotence = z.infer<typeof messageAttachmentIdempotence>

const messageAttachment = z.object({
    fileName: z.string(),
    name: z.string(),
    mime: z.string(),
    height: z.number().optional(),
    unveiled: z.boolean(),
})
export type MessageAttachment = z.infer<typeof messageAttachment>

const message = z.object({
    deleted: z.boolean().optional(),
    edited: z.boolean().optional(),
    time: z.number(),
    userID: z.string(),
    content: z.string(),
    attachment: messageAttachment.optional(),
    informs: z.array(z.string())
})
export type Message = z.infer<typeof message>


const messageActionAttachment = z.object({
    name: z.string(),
    mime: z.string(),
    height: z.number().optional(),
})
export type MessageActionAttachment = z.infer<typeof messageActionAttachment>

const messageAction = z.object({
    attachment: messageActionAttachment.optional(),
    content: z.string(),
    roomID: z.number(),
    informs: z.array(z.string()),
    idempotence: z.string(),
})
export type MessageAction = z.infer<typeof messageAction>

const role = z.object({
    roleID: z.number(),
    name: z.string().optional(),
    rank: z.number().optional(),
    defaultAdmin: z.boolean().optional(),
    common: z.boolean().optional(),
    denied: z.array(z.string()).optional(),
    allowed: z.array(z.string()).optional(),
})

export type Role = z.infer<typeof role>

const rolePermissionState = z.enum(['allowed', 'neutral', 'denied'])
export type RolePermissionState = z.infer<typeof rolePermissionState>

export const actionsData = {
    userIsActive0: z.tuple([]),
    setVoiceMute0: z.tuple([
        z.boolean(),
        z.boolean(),
    ]),
    setVoiceDeafen0: z.tuple([
        z.boolean(),
    ]),
    setVoiceTalking0: z.tuple([
        z.boolean(),
    ]),
    sendMessageSFU0: z.tuple([
        messageToSFU
    ]),
    newChannel0: z.tuple([]),
    deleteChannel0: z.tuple([
        z.number(),
    ]),
    setChannelRolePermission0: z.tuple([
        z.number(),
        z.number(),
        z.string(),
        rolePermissionState,
    ]),
    deleteChannelPermissions0: z.tuple([
        z.number(),
    ]),
    joinChannel0: z.tuple([
        z.number(),
        z.boolean(),
        z.boolean(),
    ]),
    setChannelName0: z.tuple([
        z.number(),
        z.string(),
    ]),
    newRoom0: z.tuple([]),
    newMessage0: z.tuple([messageAction]),
    unveilAttachment0: z.tuple([messageAttachmentIdempotence]),
    deleteMessage0: z.tuple([
        z.number(),
        z.number(),
        z.number(),
    ]),
    editMessage0: z.tuple([
        z.number(),
        z.number(),
        z.number(),
        z.string(),
    ]),
    deleteRoom0: z.tuple([
        z.number()
    ]),
    setRoomName0: z.tuple([
       z.number(),
       z.string(),
    ]),
    setRoomDescription0: z.tuple([
       z.number(),
       z.string(),
    ]),
    deleteRoomPermissions0: z.tuple([
       z.number(),
    ]),
    setRoomRolePermission0: z.tuple([
        z.number(),
        z.number(),
        z.string(),
        rolePermissionState,
    ]),
    newServerRole0: z.tuple([]),
    giveServerRole0: z.tuple([
        z.string(),
        z.number(),
    ]),
    revokeServerRole0: z.tuple([
        z.string(),
        z.number(),
    ]),
    deleteServerRole0: z.tuple([
        z.number(),
    ]),
    setRoleName0: z.tuple([
        z.number(),
        z.string(),
    ]),
    setRoleRank0: z.tuple([
        z.number(),
        z.number()
    ]),
    setServerRolePermission0: z.tuple([
        z.number(),
        z.string(),
        rolePermissionState,
    ]),
    setServerName0: z.tuple([
        z.string()
    ]),
    requestProfileUpload0: z.tuple([z.number()]),
    setProfile0: z.tuple([z.number()]),
    call0: z.tuple([
        z.any(), // TODO: Replace with callCommands
    ]),
    setVersions0: z.tuple([
        z.number(),
        z.string()
    ])
}

export type ActionsKey = keyof typeof actionsData
export type ActionData<T extends ActionsKey> = z.infer<typeof actionsData[T]>

const room = z.object({
    permissions: z.array(role),
    name: z.string(),
    description: z.string(),
    nextMessageID: z.number(),
    chunkCount: z.number(),
    deleted: z.boolean(),
})
export type Room = z.infer<typeof room>

const chunk = z.object({
    messages: z.array(message)
})
export type Chunk = z.infer<typeof chunk>

const voiceState = z.object({
    selfMute: z.boolean(),
    selfDeafen: z.boolean(),
    talking: z.boolean(),
    channelID: z.number(),
    userID: z.string(),
    peerID: z.number(),
    connected: z.boolean(),
})
export type VoiceState = z.infer<typeof voiceState>

const channel = z.object({
    channelID: z.number(),
    name: z.string(),
    permissions: z.array(role).optional()
})
// TODO: Rename to VoiceChannel again
export type Channel = z.infer<typeof channel>

const activeChannel = z.object({
    channelID: z.number(),
    connectedUsers: z.array(voiceState),
})
export type ActiveChannel = z.infer<typeof activeChannel>

const serverUser = z.object({
    userID: z.string(),
    lastSeen: z.number(),
    profileTimestamp: z.number(),
    connected: z.number(),
})
export type ServerUser = z.infer<typeof serverUser>

const serverInfo = z.object({
    name: z.string()
})
export type ServerInfo = z.infer<typeof serverInfo>

const updateObject = z.object({
    path: z.string().optional(),
    version: z.number(),
    data: z.undefined(),
    type: z.literal('undefined'),
})

const updateObjectVariants = z.discriminatedUnion('type', [
    updateObject,
    updateObject.extend({
        type: z.literal('chunk'),
        data: chunk
    }),
    updateObject.extend({
        type: z.literal('room'),
        data: room,
    }),
    updateObject.extend({
        type: z.literal('rooms'),
        data: z.array(z.number()),
    }),
    updateObject.extend({
        type: z.literal('channels'),
        data: z.array(channel),
    }),
    updateObject.extend({
        type: z.literal('activeChannels'),
        data: z.array(activeChannel),
    }),
    updateObject.extend({
        type: z.literal('users'),
        data: z.array(serverUser),
    }),
    updateObject.extend({
        type: z.literal('userRoles'),
        data: z.record(z.array(z.number())),
    }),
    updateObject.extend({
        type: z.literal('serverRoles'),
        data: z.object({
            list: z.array(role),
            deleted: z.record(z.boolean()),
        }),
    }),
    updateObject.extend({
        type: z.literal('serverInfo'),
        data: z.object({
            name: z.string()
        })
    })
])
export type UpdateObjectVariants = z.infer<typeof updateObjectVariants>

export const updateObjects = z.array(updateObjectVariants)

const definedPermission = z.object({
    title: z.string(),
    id: z.string(),
    scope: z.string(),
})
export type DefinedPermission = z.infer<typeof definedPermission>

export const serverToClientProvision = z.object({
    definedPermissions: z.array(definedPermission),
    supportedActions: z.array(z.string()),
    attachmentsURL: z.string(),
    profilesURL: z.string(),
    // TODO: Add iceServers
})

export type ServerToClientProvision = z.infer<typeof serverToClientProvision>

export const DEFAULT_SIGN_ALGORITHM: RsaHashedImportParams = {
    name: 'RSASSA-PKCS1-v1_5',
    hash: 'SHA-512',
}

export const imageEmbeddedProfile = z.object({
    userName: z.string(),
    timestamp: z.number(),
})
export type ImageEmbeddedProfile = z.infer<typeof imageEmbeddedProfile>
