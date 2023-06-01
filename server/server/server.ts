import config from "./config.ts"
import { getLog } from './log.ts'

import { fromRadix64, unitTest as radix64UnitTest } from './radix64.ts'

import { verifyNonce, unitTest as authUnitTest, randomNonce } from './auth.ts'
import { parseX509Chain } from './x509_chains.ts'
import {
    addGlobalChangeListener,
    removeGlobalChangeListener,
    update,
    updatePure,
    updateGradually,
} from './versioned.ts'
import {
    saveAllJson,
    setDataPath,
} from './json.ts'
import {
    getAttachmentUpload,
    getProfileUpload,
    randomAttachmentPrefix,
} from './attachments.ts'
import { serverInfoSavable, setServerName, loadData as loadServerInfo} from './info.ts'
import {
    loadData as loadChannelsData,
    sendMessageSFU,
    mediaWorkerConnected,
    createChannel,
    setChannelName,
    joinChannel,
    deleteChannel,
    deleteChannelPermissions,
    setChannelRolePermission,
    canUserInChannel,
    setVoiceSelfMute,
    setVoiceTalking,
    setVoiceSelfDeafen,
    StoredChannels,
    channelsSavable,
activeChannels,
setClientMessageCallback,
} from './channels.ts'
import {
    createRoom,
    deleteRoom,
    canUserInRoom,
    setRoomName,
    setRoomDescription,
    deleteRoomPermissions,
    createMessage,
    editMessage,
    deleteMessage,
    setRoomRolePermission,
    unitTest as roomsUnitTest,
    loadData as loadRoomsData,
    StoredRoomList,
    roomsGroup,
    roomListSavable,
    roomChunk,
unveilMessageAttachment,
} from './rooms.ts'
import {
    unitTest as rolesUnitTest,
    loadData as loadRolesData,
    canUserGlobally,
    createRole,
    deleteRole,
    setServerRoleName,
    setServerRoleRank,
    setServerRolePermission,
    canUserInContext,
    giveServerRole,
    revokeServerRole,
    firstRoleAssignment,
    findDefaultAdminRoleID,
    roleAssignmentsSavable,
    serverRolesSavable,
    serverDefinedPermissions
} from './roles.ts'

// TODO: Reimplement notifications
import { createInform, getNextInform } from './informs.ts'
import { serverUsers, loadData as loadUsersData, userWasActive, userGoesOffline, userGoesOnline, userChangesProfile} from './users.ts'

import { type VoiceState, actionsData, type ActionsKey, type ActionData, type Room, type Chunk, type UpdateObjectVariants, type ServerToClientProvision, DEFAULT_SIGN_ALGORITHM, MessageActionAttachment, MessageAttachment, MessageAttachmentIdempotence, ProfileUploadURL } from './schema.ts'
import { createBuckets, getBucketURL, startS3 } from "./s3.ts";

const {error, info} = getLog('server')

// TODO: Reimplement suggest update feature
const NEWEST_CLIENT_VERSION = '0.3.1'

function acceptableVersion(version: string) {
    if (typeof version !== 'string') {
        return false
    }
    const [majorVersionStr, minorVersionStr, _patchVersion] = version.split('.')
    const majorVersion = parseInt(majorVersionStr || '')
    const minorVersion = parseInt(minorVersionStr || '')

    if (majorVersion === 0) {
        if (minorVersion >= 3) {
            return true
        } else {
            return false
        }
    } else {
        return true
    }
}

class MissingNonce {
    nonce: string
    constructor(nonce: string) {
        this.nonce = nonce
    }
}

interface ReceivedVersion {
    original: string
    path: string[],
    version: number,
}

class Session {
    static nextPeerID = 0
    currentSSE?: ReadableStreamDefaultController<Uint8Array> = undefined
    synchronizationCount = 0
    sessionNumber = 0

    // Authentication
    nonce: string
    authorized = false
    userID = '' // TODO: duplicates info from voiceStat, fix?

    parsedVersions: ReceivedVersion[] = []
    chatMessages: Map<string, MessageAttachmentIdempotence|''> = new Map()

    // VC stuff.
    voiceState: VoiceState = {
        selfMute: false,
        selfDeafen: false,
        talking: false,
        channelID: -1,
        peerID: ++Session.nextPeerID,
        userID: 'unset',
        connected: false,
    }

    // Anti DOS
    failedLoginAttempts = 0
    blocked = false

    constructor(nonce: string) {
        this.nonce = nonce
    }

}

// TODO: sessionByToken should instead be a Map<String, PeerID> AND getSession should do a double lookup!
const sessionByToken: Map<string, Session> = new Map()

const sessionByPeerID: Map<number, Session> = new Map()
function getSession(token: string) {
    // TODO: --- maybe each session should include clientIP and force reauthentication if the IP changes to prevent token stealing?
    let session = sessionByToken.get(token)
    if (session === undefined) {
        session = new Session(randomNonce(
            config.publicIP,
            config.serverID,
        ))
        sessionByToken.set(token, session)
        sessionByPeerID.set(session.voiceState.peerID, session)
    }
    return session
}

async function prepareAttachment(attachment?: MessageActionAttachment): Promise<{
    uploadURL: string,
    messageAttachment: MessageAttachment|undefined
}> {
    if (!attachment) {
        return {uploadURL: '', messageAttachment: undefined}
    }

    // TODO: Make sure attachmentName is safe!
    const fileName = randomAttachmentPrefix() + attachment.name
    const uploadURL = await getAttachmentUpload(fileName)
    info('uploadURL:', uploadURL)

    return {
        uploadURL,
        messageAttachment: {
            fileName,
            name: attachment.name,
            height: attachment.height,
            mime: attachment.mime,
            unveiled: false,
        }
    }
}

function sendAttachmentIdempotence(session: Session, idempotence: MessageAttachmentIdempotence|'') {
    if (idempotence === '') {
        // Empty string means message was uploaded without an attachment -
        // therefore we do not send a special idempotence reply.
        return
    }
    if (session.currentSSE) {
        // TODO: Encapsulate all currentSSE actions into a function.
        session.currentSSE.enqueue(utf8Encoder.encode(`event: newAttachmentURL0\r\ndata: ${JSON.stringify(idempotence)}\r\n\r\n`))
    }
}

function sendProfileUploadURL(session: Session, uploadURL: string, profileTimestamp: number) {
    const data: ProfileUploadURL = {
        uploadURL,
        userID: session.userID,
        profileTimestamp,
    }
    if (session.currentSSE) {
        session.currentSSE.enqueue(utf8Encoder.encode(`event: newProfileURL0\r\ndata: ${JSON.stringify(data)}\r\n\r\n`))
    }
}

const actions: {
    [ActionName in ActionsKey]?: (s: Session, ...data: ActionData<ActionName>) => (void|Promise<void>)
} = {}

actions.userIsActive0 = ({userID}) => {
    info('user is now active')
    // TODO: This seems like a bad name tbh.
    userWasActive(userID)
}

actions.setVoiceMute0 = ({voiceState}, selfMute, talking) => {
    setVoiceSelfMute(voiceState, selfMute, talking)
}

actions.setVoiceDeafen0 = ({voiceState}, selfDeafen) => {
    setVoiceSelfDeafen(voiceState, selfDeafen)
}

actions.setVoiceTalking0 = ({voiceState}, talking) => {
    setVoiceTalking(voiceState, talking)
}

actions.sendMessageSFU0 = ({voiceState}, message) => {
    info('message the sfu', message)
    sendMessageSFU(voiceState, message)
}

actions.newChannel0 = async ({userID}) => {
    if (!canUserGlobally('edit_channels', userID)) {
        throw 'user lacks permission to perform this action'
    }
    createChannel()
}

actions.deleteChannel0 = async ({userID}, channelID) => {
    if (!canUserGlobally('edit_channels', userID)) {
        throw 'user lacks permission to perform this action'
    }
    deleteChannel(channelID)
}

actions.setChannelRolePermission0 = async ({userID}, channelID, roleID, permission, state) => {
    if (!canUserGlobally('edit_roles', userID)) {
        throw 'user lacks permission to perform this action'
    }
    setChannelRolePermission(channelID, roleID, permission, state)
}

actions.deleteChannelPermissions0 = async ({userID}, channelID) => {
    if (!canUserGlobally('edit_roles', userID)) {
        throw 'user lacks permission to perform this action'
    }
    deleteChannelPermissions(channelID)
}

actions.joinChannel0 = async ({userID, voiceState}, channelID, selfMute, selfDeafen) => {
    if (!canUserInChannel('join_channel', userID, channelID)) {
        throw 'user lacks permission to perform this action'
    }
    if (channelID !== -1) {
        setVoiceSelfMute(voiceState, selfMute, false)
        setVoiceSelfDeafen(voiceState, selfDeafen)
    }
    joinChannel(voiceState, channelID)
}

actions.setChannelName0 = async ({userID}, channelID, name) => {
    if (!canUserGlobally('edit_channels', userID)) {
        throw 'user lacks permission to perform this action'
    }
    setChannelName(channelID, name)
}

actions.newRoom0 = async ({userID}) => {
    info('new room by', userID)
    if (!canUserGlobally('edit_rooms', userID)) {
        throw 'user lacks permission to perform this action'
    }
    await createRoom()
}

actions.newMessage0 = async (
    session,
    {
        attachment,
        content,
        roomID,
        informs,
        idempotence,
    }
) => {
    if (!(await canUserInRoom('write_chat', session.userID, roomID))) {
        throw 'user is not allowed to post in this room'
    }

    const existingMessage = session.chatMessages.get(idempotence)
    if (existingMessage !== undefined) {
        sendAttachmentIdempotence(session, existingMessage)
        return
    }

    const { uploadURL, messageAttachment }
        = await prepareAttachment(attachment)

    const { chunkID, messageIndex } = await createMessage(
        session.userID,
        roomID,
        content,
        messageAttachment,
        informs
    )

    const messageIdempotence = messageAttachment ? {
        chunkID,
        messageIndex,
        idempotence,
        roomID,
        uploadURL,
    } : ''
    session.chatMessages.set(idempotence, messageIdempotence)
    sendAttachmentIdempotence(session, messageIdempotence)

    // TODO: Maybe some kind of DOS-attack protection?
    for (const informUserID of informs) {
        createInform(informUserID, 'new_message', {
            posterID: session.userID,
            roomID,
            content,
        })
    }
}

actions.unveilAttachment0 = async (
    { userID },
    {roomID, chunkID, messageIndex}
) => {
    await unveilMessageAttachment(userID, roomID, chunkID, messageIndex)
}


actions.deleteMessage0 = async (
    { userID },
    roomID, chunkID, messageIndex
) => {
    if (await canUserInRoom('clean_chat', userID, roomID)) {
        await deleteMessage(roomID, chunkID, messageIndex, userID, true)
    } else if (await canUserInRoom('retract_chat', userID, roomID)) {
        await deleteMessage(roomID, chunkID, messageIndex, userID, false)
    } else {
        throw 'you are not allowed to retract messages here'
    }
}

actions.editMessage0 = async (
    { userID },
    roomID, chunkID, messageIndex, content
) => {
    // TODO: Maybe this action should be renamed to "set-"something

    if (!(await canUserInRoom('edit_chat', userID, roomID))) {
        throw 'user is not allowed to edit messages in this room'
    }
    await editMessage(roomID, chunkID, messageIndex, content, userID)
}

actions.deleteRoom0 = async ({userID}, roomID) => {
    if (!canUserGlobally('edit_rooms', userID)) {
        throw 'user lacks permission to perform this action'
    }
    await deleteRoom(roomID)
}

actions.setRoomName0 = async ({userID}, roomID, name) => {
    if (!(await canUserInRoom('rename_room', userID, roomID))) {
        throw 'user is not allowed to rename this room'
    }
    await setRoomName(roomID, name)
}

actions.setRoomDescription0 = async ({userID}, roomID, description) => {
    if (!(await canUserInRoom('rename_room', userID, roomID))) {
        throw 'user is not allowed change the description for this room'
    }
    await setRoomDescription(roomID, description)
}

actions.deleteRoomPermissions0 = async ({userID}, roomID) => {
    if (!canUserGlobally('edit_roles', userID)) {
        throw 'user lacks permission to perform this action'
    }
    await deleteRoomPermissions(roomID)
}

actions.setRoomRolePermission0 = async (
    { userID },
    roomID, roleID, permission, state,
) => {
    if (!canUserGlobally('edit_roles', userID)) {
        throw 'user lacks permission to perform this action'
    }
    await setRoomRolePermission(roomID, roleID, permission, state)
}

actions.newServerRole0 = async ({userID}) => {
    if (!canUserGlobally('edit_roles', userID)) {
        throw 'user lacks permission to perform this action'
    }
    createRole()
}

actions.giveServerRole0 = (session, userID, roleID) => {
    if (!canUserGlobally('edit_roles', session.userID)) {
        throw 'user lacks permission to perform this action'
    }
    giveServerRole(userID, roleID)
}

actions.revokeServerRole0 = (session, userID, roleID) => {
    if (!canUserGlobally('edit_roles', session.userID)) {
        throw 'user lacks permission to perform this action'
    }
    revokeServerRole(userID, roleID)
}

actions.deleteServerRole0 = ({userID}, roleID) => {
    if (!canUserGlobally('edit_roles', userID)) {
        throw 'user lacks permission to perform this action'
    }
    deleteRole(roleID)
}

actions.setRoleName0 = async ({userID}, roleID, name) => {
    if (!canUserGlobally('edit_roles', userID)) {
        throw 'user lacks permission to perform this action'
    }
    setServerRoleName(roleID, name)
}

actions.setRoleRank0 = ({userID}, roleID, rank) => {
    if (!canUserGlobally('edit_roles', userID)) {
        throw 'user lacks permission to perform this action'
    }
    setServerRoleRank(roleID, rank)
}

actions.setServerRolePermission0 = (
    {userID},
    roleID, permission, state
) => {
    if (!canUserGlobally('edit_roles', userID)) {
        throw 'user lacks permission to perform this action'
    }
    setServerRolePermission(roleID, permission, state)
}

actions.setServerName0 = async ({userID}, name) => {
    if (!canUserGlobally('edit_server_info', userID)) {
        throw 'user lacks permission to perform this action'
    }
    setServerName(name)
}

actions.requestProfileUpload0 = async (session, profileTimestamp) => {
    const url = await getProfileUpload(session.userID, profileTimestamp)
    sendProfileUploadURL(session, url, profileTimestamp)
}

actions.setProfile0 = async ({userID}, profileTimestamp) => {
    userChangesProfile(userID, profileTimestamp)
}

actions.setVersions0 = (session, sessionNumber, versions) => {
    if (session.sessionNumber !== sessionNumber) {
        return
    }
    info(versions)
    session.parsedVersions = versions.split('~').map(e => {
        const path = e.split('.')
        return {
            original: e,
            path,
            version: fromRadix64(path[path.length - 1] || '')
        }
    })
    attemptSynch(session)
}

function parseInt0(txt?: string): number {
    return parseInt(txt || '')
}

const roomsTransform = (v: StoredRoomList) => v.list
const roomTransform = async (v: Room, [{userID}, roomID]: [Session, number]) =>
    (await canUserInRoom('read_chat', userID, roomID) ||
     canUserInContext('edit_roles', userID, undefined, undefined)) ? v : undefined
const chunkTransform = async (v: Chunk, [{ userID }, roomID]: [Session, number]) =>
    await canUserInRoom('read_chat', userID, roomID) ||
    canUserInContext('edit_roles', userID, undefined, undefined) ? v : undefined
const channelsTransformer = (v: StoredChannels, {userID}: Session) => v.list.filter((c: any) =>
    canUserInContext('join_channel', userID, undefined, c.permissions) ||
    canUserInContext('edit_roles', userID, undefined, undefined))

async function objectRouter(session: Session, into: UpdateObjectVariants, path: string[], version: number) {
    switch (into.type) {
        case 'chunk': {
            const roomID = parseInt0(path[1])
            const room = await roomChunk(roomID, parseInt0(path[2])) 
            await update(room[1], into, version, [session, roomID], chunkTransform)
            return
        }
        case 'room': {
            const roomID = parseInt0(path[1])
            await update(await roomsGroup.open(roomID), into, version, [session, roomID], roomTransform)
            return
        }
        case 'rooms':
            await update(roomListSavable[1], into, version, undefined, roomsTransform)
            return
        case 'channels':
            await update(channelsSavable[1], into, version, session, channelsTransformer)
            return
        case 'activeChannels':
            updateGradually(activeChannels, into, version)
            return
        case 'users':
            updateGradually(serverUsers, into, version)
            return
        case 'userRoles':
            updatePure(roleAssignmentsSavable[1], into, version)
            return
        case 'serverRoles':
            updatePure(serverRolesSavable[1], into, version)
            return
        case 'serverInfo':
            updatePure(serverInfoSavable[1], into, version)
            return
        default:
            throw 'unsupported path: ' + path
    }
}

const utf8Encoder = new TextEncoder()

async function attemptSynch(session: Session) {
    if (!session.authorized) {
        return
    }

    const updates: UpdateObjectVariants[] = []
    let synchronizationCount = ++session.synchronizationCount

    let updateObject: UpdateObjectVariants = {
        type: 'undefined',
        path: undefined,
        data: undefined,
        version: -1,
    }
    for (const version of session.parsedVersions) {
        updateObject.version = -1
        updateObject.type = version.path[0] as any
        //console.log('type:', updateObject.type)
        await objectRouter(session, updateObject, version.path, version.version)
        if (updateObject.version >= 0) {
            updateObject.path = version.path.length <= 2 ? undefined : version.original
            updates.push(updateObject)
            updateObject = {
                type: 'undefined',
                path: undefined,
                data: undefined,
                version: -1,
            }
        }
    }

    if (synchronizationCount === session.synchronizationCount && updates.length > 0 && session.currentSSE !== undefined) {
        session.currentSSE.enqueue(utf8Encoder.encode(`event: update0\r\ndata: ${JSON.stringify(updates)}\r\n\r\n`))
    }
}

function sendProvision(controller: ReadableStreamDefaultController<Uint8Array>) {
    const provision: ServerToClientProvision = {
        definedPermissions: serverDefinedPermissions,
        attachmentsURL: getBucketURL('attachments'),
        profilesURL: getBucketURL('profiles'),
        supportedActions: Object.keys(actions)
    }
    controller.enqueue(utf8Encoder.encode(`event: provision0\r\ndata: ${JSON.stringify(provision)}\r\n\r\n`))
}

function sendSessionNumber(controller: ReadableStreamDefaultController<Uint8Array>, n: number) {
    controller.enqueue(utf8Encoder.encode(`event: sessionNumber0\r\ndata: ${n}\r\n\r\n`))
}

function startClientSSE(session: Session): Response {
    session.parsedVersions = []
    session.sessionNumber++
    let sse: ReadableStreamDefaultController<Uint8Array>|undefined = undefined
    const globalChangeListenerIndex = addGlobalChangeListener(attemptSynch.bind(undefined, session))
    if (session.currentSSE) {
        // Close the existing SSE.
        session.currentSSE.close()
    }
    if (session.authorized) {
        // If we are already authenticated,
        // we don't need to wait for a message.
        authenticatedGoesOnline(session)
    }

    function onDisconnect() {
        removeGlobalChangeListener(globalChangeListenerIndex)
        info(`session with peer ID ${session.voiceState.peerID} disconnected`)
        if (session.currentSSE === sse) {
            session.currentSSE = undefined
        }
        if (session.authorized) {
            userGoesOffline(session.userID)
        }
        if (session.voiceState.channelID !== -1) {
            joinChannel(session.voiceState, -1)
        }
    }

    const body = new ReadableStream({
        start(controller) {
            sse = controller
            session.currentSSE = sse
            sendProvision(controller)
            sendSessionNumber(controller, session.sessionNumber)
        },
        cancel: onDisconnect
    })


    return new Response(body, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Keep-Alive': 'timeout=9007199254740991',
            'Connection': 'Keep-Alive', // Oak seems to set this and the above.
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'cache-control',
            'X-Accel-Buffering': 'no',
        }
    })
}

function checkFirstUserJoined(userID: string) {
    if (firstRoleAssignment()) {
        info('grant user default admin role')
        const adminRoleID = findDefaultAdminRoleID()
        if (adminRoleID !== undefined) {
            giveServerRole(userID, adminRoleID)
        }
    }
}

function authenticatedGoesOnline(session: Session) {
    userGoesOnline(session.userID)
    session.voiceState.userID = session.userID
    checkFirstUserJoined(session.userID)
    attemptSynch(session)
}

async function handleX509Authenticate(session: Session, nonce: string, x509Chain: string): Promise<Session> {
    info('user chain auth')
    const parsedChain = parseX509Chain(x509Chain)
    try {
        const analysis = await verifyNonce(
            DEFAULT_SIGN_ALGORITHM,
            parsedChain,
            config.adams,
            session.nonce,
            nonce
        )
        if (!canUserGlobally('join_server', analysis.userID)) {
            throw 'user lacks permission to join'
        }
        session.authorized = true
        session.userID = analysis.userID
        authenticatedGoesOnline(session)
        return session
    } catch (e) {
        session.authorized = false
        session.failedLoginAttempts++
        if (typeof e === 'string') {
            throw e
        } else {
            error(e)
            throw 'internal error'
        }
    }
}


function ensureAuthenticated(url: URL, nonce?: string, userChain?: string, session?: Session): Promise<Session>|Session {
    if (session === undefined) {
        throw 'token must be provided for this endpoint'
    }
    if (session.authorized && session.userID !== '') {
        // All is well.
        return session
    }

    const appVersion = url.searchParams.get('appVersion')
    const isDeveloper = url.searchParams.has('isDeveloper')

    if (typeof appVersion !== 'string') {
        throw 'provide appVersion or set isDeveloper = true'
    } else if (!acceptableVersion(appVersion) && !isDeveloper) {
        throw 'unsupported client version'
    } else if (session.failedLoginAttempts >= 12) {
        session.blocked = true
        throw 'session has been blocked'
    }

    if (!nonce) {
        throw new MissingNonce(session.nonce)
    }

    if (userChain === undefined) {
        throw 'userChain must be provided'
    }

    // @peculiar/x509 does not like it when PEM data contains
    // windows newlines. This causes problem because FormData likes
    // to encode strings that way.
    nonce = nonce.replace(/\r/g, '')
    userChain = userChain.replace(/\r/g, '')

    return handleX509Authenticate(session, nonce, userChain)
}

// TODO: possibly deprecate in the future in case we no longer need it...
function formDataToArgs(formData: FormData): any[] {
    const result: any[] = []
    for(const value of formData.getAll('arg')) {
        if (value === 'undefined') {
            result.push(undefined)
        } else if (typeof value === 'string') {
            result.push(JSON.parse(value))
        } else if (value instanceof File) {
            result.push(value)
        } else {
            throw 'unsupported type in FormData'
        }
    }
    return result
}

async function requestHandler(req: Request, url: URL, session?: Session): Promise<Response> {
    if (req.method === 'OPTIONS') {
        return new Response('', { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'cache-control',
            'Allow': 'OPTIONS, GET, POST'
        }})
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
        return new Response('only GET and POST are supported', { status: 405, headers: {
            'Access-Control-Allow-Origin': '*',
        }})
    }

    const parts = url.pathname.split(/[\/\\\.]/, 64)
    info(parts)

    // TODO: perhaps put the actionName in the url instead
    if (parts[1] === 'action') {
        let args: unknown = []
        let userChain: string|undefined = undefined
        let nonce: string|undefined = undefined
        const contentType = req.headers.get('Content-Type')
        if (contentType && contentType.startsWith('multipart/form-data')) {
            const formData = await req.formData()
            const possibleUserChain = formData.get('userChain')
            const possibleNonce = formData.get('nonce')
            userChain = typeof possibleUserChain === 'string' ? possibleUserChain : undefined
            nonce = typeof possibleNonce === 'string' ? possibleNonce : undefined
            args = formDataToArgs(formData)
        } else {
            const msg = await req.json()
            userChain = msg.userChain
            nonce = msg.nonce
            args = msg.args
        }

        if (userChain !== undefined && typeof userChain !== 'string') {
            throw 'userChain must be a string'
        }

        if (nonce !== undefined && typeof nonce !== 'string') {
            throw 'nonce must be a string'
        }


        const authorized = await ensureAuthenticated(url,
                                                     nonce,
                                                     userChain,
                                                     session)

        const name = url.searchParams.get('action') as ActionsKey
        if (typeof name !== 'string') {
            throw 'name must be a string'
        }
        if(!(name in actions))  {
            throw 'name is not a supported action'
        }
        const actionData = actionsData[name]
        const data = actionData.parse(args)
        const handler = actions[name] as (...any: any[]) => Promise<void>
        await handler(authorized, ...data)
        return new Response('', { status: 200, headers: {
            // TODO: Is the header even required in this case?
            'Access-Control-Allow-Origin': '*',
        }})
    } else if (parts[1] === 'updates') {
        if (!session) {
            throw 'please provide a valid token'
        }
        return startClientSSE(session)
    } else if (parts[1] === 'ice') {
        // TODO: Is this even used?
        return new Response(JSON.stringify(config.iceServers), { status: 200, headers: {
            'Access-Control-Allow-Origin': '*',
        }})
    } else if (parts[1] === 'media-worker') {
        const { response, socket } = Deno.upgradeWebSocket(req)
        mediaWorkerConnected(socket, parseInt(parts[2] || ''), parts[3] || '')
        return response
    }
    return new Response('unsupported endpoint', { status: 404, headers: {
        'Access-Control-Allow-Origin': '*',
    }})
}

async function commonRequestResponder(httpConnection: Deno.RequestEvent, url: URL, session?: Session) {
    let response
    try {
        response = await requestHandler(httpConnection.request, url, session)
    } catch (e) {
        if (typeof e === 'string') {
            // A string means that we wish to show
            response = new Response(e, { status: 400, headers: {
                'Access-Control-Allow-Origin': '*',
            }})
        } else if (e instanceof MissingNonce) {
            // We get here if an authentication is required but no nonce
            // is provided by client.
            response = new Response(e.nonce, { status: 401, headers: {
                'Access-Control-Allow-Origin': '*',
            }})
        } else {
            error(e)
            response = new Response('internal server error', { status: 500, headers: {
                'Access-Control-Allow-Origin': '*',
            }})
        }
    }
    try {
        await httpConnection.respondWith(response)
    } catch (e) {
        // https://github.com/denoland/deno/issues/11595
        error(e)
    }
}

async function commonConnectionLoop(connection: Deno.Conn) {
    try {
        let session: Session|undefined = undefined
        const http = Deno.serveHttp(connection)
        while(true) {
            let httpConnection: Deno.RequestEvent|null = null
            try {
                httpConnection = await http.nextRequest()
            } catch (e) {
                error('while reading HTTP connection:', e)
            }
            if (httpConnection === null) {
                break
            }

            const url = new URL(httpConnection.request.url)
            const token = url.searchParams.get('token')
            if (token === '') {
                httpConnection.respondWith(new Response('insecure choice of token', { status: 400, headers: {
                    'Access-Control-Allow-Origin': '*',
                }}))
                continue
            } else if (token) {
                session = getSession(token)
            }

            commonRequestResponder(httpConnection, url, session)
        }
    } catch (e) {
        error(e)
    }
}

async function startHttp(port: number) {
    for await (const connection of Deno.listen({
        port,
    })) {
        commonConnectionLoop(connection)
    }
}

async function startHttps2(port: number) {
    const certWatcher = Deno.watchFs(config.certFile, {recursive: false})
    const certWatcherIter = certWatcher[Symbol.asyncIterator]()
    while(true) {
        const connectionIter = Deno.listenTls({
            port,
            reusePort: true,
            certFile: config.certFile,
            keyFile: config.keyFile,
            alpnProtocols: ["h2", "http/1.1"],
        })
        while(true) {
            const promiseResult = await Promise.any([certWatcherIter.next(),
                                                     connectionIter.accept()])
            if ('localAddr' in promiseResult) {
                info('new connection')
                commonConnectionLoop(promiseResult)
            } else {
                connectionIter.close()

                // Give the scheduler time to close the port.
                await new Promise(ok => setTimeout(ok, 10))
                info('reload cert')
                break
            }

        }
    }
}

// TODO: Respond with HTTP code 204 instead of 200 where it is appropriate!

async function main() {
    if (Deno.env.get('TAIGACHAT_RUN_SELF_TEST') == '1') { // TODO: either move to Deno tests / bun tests, remove or make part of the config
            radix64UnitTest()
            rolesUnitTest()
            authUnitTest()
            roomsUnitTest()
            return
    }

    info('starting server:', config.serverID)


    setDataPath(config.dataPath)

    // TODO: Do a Promise.all
    await loadServerInfo()
    await loadRolesData()
    await loadChannelsData()
    await loadRoomsData()
    await loadUsersData()

    startS3()
    createBuckets()

    setClientMessageCallback(function(channelID, peer, msg) {
        const session = sessionByPeerID.get(peer)
        if (session === undefined
           || session.voiceState.channelID !== channelID
           || session.currentSSE === undefined) {
            return
        }
        session.currentSSE.enqueue(utf8Encoder.encode(`event: sfuMessage0\r\ndata: ${JSON.stringify(msg)}\r\n\r\n`))
    })

    if (typeof config.httpPort === 'number') {
        startHttp(config.httpPort)
    }

    if (typeof config.httpsPort === 'number') {
        startHttps2(config.httpsPort)
    }

    saveAllJson()
    setInterval(saveAllJson, 10000)
}

main()


