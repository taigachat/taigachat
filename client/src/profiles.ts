import { exportAsSHA512, importPKCS7, verifyX509Chain } from './x509_chains'
import { encodePNG, decodePNG, findChunkByTag, PNGChunk } from './png'
import { imageEmbeddedProfile, DEFAULT_SIGN_ALGORITHM, ImageEmbeddedProfile } from './schema'
import { EMPTY_URL } from './join_url'
import { fromBase64 } from 'encoding_schemes'
//import { z } from 'zod'

const PROFILE_DATA_TAG = 'hpRF'
const PROFILE_SIGNATURE_TAG = 'hsIG'
const PROFILE_CHAIN_TAG = 'hcHN'

interface Profile {
    profileData: ImageEmbeddedProfile,
    objectURL: string,
    arrayBuffer: ArrayBuffer,
    missingIDAT: boolean,
    references: number,
}
const profiles: Record<string, Promise<Profile>> = {}

interface ProfileWatcher {
    version: number
    watchers: ((version: number) => void)[] // TODO: What if it is modified while
}
const profileWatchers: Record<string, ProfileWatcher> = {}
function getProfileWatcher(userID: string): ProfileWatcher {
    if (userID in profileWatchers) {
        return profileWatchers[userID]!
    }
    const watcher = {
        version: 0,
        watchers: []
    }
    profileWatchers[userID] = watcher
    return watcher
}

/**
 * Pops a chunk but only if the tag matches
 */
function popTag(tag: String, chunks: PNGChunk[]) {
    const peek = chunks[chunks.length - 1]
    if (peek === undefined) {
        throw 'could not find ' + tag
    }
    if (peek.tag !== tag) {
        throw `tag name missmatch: ${peek.tag}, expected: ${tag}`
    }
    chunks.pop()
    return peek
}

function isMissingIDAT(chunks: PNGChunk[]) {
    return chunks.find(c => c.tag === 'IDAT') === undefined
}

const PROFILE_NO_IDAT = fromBase64('iVBORw0KGgoAAAAASUVORK5CYII')
; (window as any).debugProfileNoIDAT = () => PROFILE_NO_IDAT


async function loadProfile(baseURL: (fileName: string) => URL, userID: string, profileTimestamp: number): Promise<Profile> {
    if (profileTimestamp === 0 || baseURL === EMPTY_URL) {
        return {
            profileData: {
                userName: shortenUserID(userID),
                timestamp: 0,
            },
            arrayBuffer: PROFILE_NO_IDAT,
            objectURL: '',
            missingIDAT: true,
            references: 0,
        }
    }
    console.log(baseURL)
    const validURL = baseURL(`${userID}/${profileTimestamp}.png`)
    const response = await fetch(validURL)
    const data = await response.blob()
    const arrayBuffer = await data.arrayBuffer()
    const chunks = decodePNG(arrayBuffer)
    popTag('IEND', chunks)
    const signatureChunk = popTag(PROFILE_SIGNATURE_TAG, chunks)
    const signedRegion = new Uint8Array(arrayBuffer,
                                        0,
                                        signatureChunk.data.byteOffset - 8)
    console.log('signedRegion:', signedRegion)

    const profileChunk         = findChunkByTag(PROFILE_DATA_TAG, chunks)
    const chainChunk           = findChunkByTag(PROFILE_CHAIN_TAG, chunks)

    const decoder        = new TextDecoder()
    const profileText    = decoder.decode(profileChunk.data)
    const profileData    = imageEmbeddedProfile.parse(JSON.parse(profileText))

    // TODO: Remove the import
    const certificates = importPKCS7(chainChunk.data)
    const analysis = await verifyX509Chain(certificates)

    const key = await exportAsSHA512(analysis.publicSessionKey, 'verify')

    // TODO: At some point, we should make sure crypto.subtle only exists in x509_chains and user_chains.ts
    const verification = await crypto.subtle.verify(DEFAULT_SIGN_ALGORITHM, key, signatureChunk.data, signedRegion)
    if (!verification) {
        throw 'could not verify image'
    }
    if (profileData.timestamp !== profileTimestamp) {
        throw 'timestamp does not match'
    }
    if (analysis.userID !== userID) {
        throw 'userID and image userID derived from key does not match'
    }

    const objectURL = URL.createObjectURL(data)
    return {
        profileData,
        arrayBuffer,
        objectURL,
        missingIDAT: isMissingIDAT(chunks),
        references: 0,
    }
}

function notifyProfileWatchers(userID: string, profileTimestamp: number) {
    const watcher = getProfileWatcher(userID)
    if (watcher.version < profileTimestamp) {
        watcher.version = profileTimestamp
        for (const cb of watcher.watchers) {
            if (cb) {
                // In case the array has been modified
                cb(watcher.version)
            }
        }
    }
}

function userAndTimestamp(userID: string, profileTimestamp: number) {
    return `${userID}/${profileTimestamp}`
}

export function getProfile(baseURL: (fileName: string) => URL, userID: string, profileTimestamp: number): Promise<Profile> {
    console.log('get profile for:', userID, profileTimestamp)
    const combined = userAndTimestamp(userID, profileTimestamp)
    if (combined in profiles) {
        console.log('already loaded')
        return profiles[combined]!
    }
    const promise = loadProfile(baseURL, userID, profileTimestamp)
    promise.then(profile => {
        notifyProfileWatchers(userID, profile.profileData.timestamp)
    }).catch(_ => {
        // Remove from list
        // TODO: Make sure the same baseURL isn't tried again
        // only different baseURLs should be allowed
        delete profiles[combined]
    })
    profiles[combined] = promise
    return promise
}

function shortenUserID(id: string) {
    return `${id.substring(0, 10)}[...]${id.slice(-10)}`
}

// TODO: Implement sweeper that runs whenever we try to load something else


const MISSING_PROFILE = './static/missing_avatar.svg#'
let incrementing_id = 0
interface ProfileLoaderArgument {
    setName: (n: string) => void,
    userID: string,
    profileTimestamp: number
    profileURL: (fileName: string) => URL
}
export function profileLoad(setName: (n: string) => void, userID: string, profileTimestamp: number, profileURL: (fileName: string) => URL): ProfileLoaderArgument {
    return {
        setName,
        userID,
        profileTimestamp,
        profileURL
    }
}

export function profileLoader(element: HTMLImageElement, args: ProfileLoaderArgument) {
    // TODO: In debug mode, element.loading == lazy should be asserted
    // TODO: Make profiles fade in once loaded

    args.setName(shortenUserID(args.userID))

    let loadedProfile: Profile|undefined = undefined

    async function onLoad() {
        if (!element.classList.contains('loaded')) {
            element.classList.add('loaded')
            const p = await getProfile(args.profileURL, args.userID, args.profileTimestamp)
            p.references++
            loadedProfile = p
            element.src =  p.missingIDAT ? MISSING_PROFILE : p.objectURL
            //console.log('setting name')
            const shortenedName = p.profileData.userName.length > 30
                ? p.profileData.userName.substring(0, 30)
                : p.profileData.userName
            args.setName(shortenedName)
        }
    }
    element.addEventListener('load', onLoad)

    function forcedUpdate(newArgs: ProfileLoaderArgument) {
        element.classList.remove('loaded')
        if (loadedProfile) {
            loadedProfile.references--
            loadedProfile = undefined
            newArgs.setName(shortenUserID(newArgs.userID))
        }
        args = newArgs
        element.src = MISSING_PROFILE + incrementing_id++
    }
    function update(newArgs: ProfileLoaderArgument) {
        if (newArgs.profileTimestamp === args.profileTimestamp &&
            newArgs.profileURL === args.profileURL &&
            newArgs.userID === args.userID) {
            // No point in updating to the same avatar.
            return
        }
        forcedUpdate(newArgs)
    }
    forcedUpdate(args)

    return {
        destroy() {
            element.removeEventListener('load', onLoad)
            if (loadedProfile) {
                loadedProfile.references--
                loadedProfile = undefined
            }
        },
        update,
    }
}

function noop() {}

export function profileWatcher(userID: string) {
    const watcher = getProfileWatcher(userID)
    return {
        subscribe(func: (p: number) => void) {
            if (watcher.version !== 0) {
                func(watcher.version)
            }
            const index = watcher.watchers.push(func) - 1
            function unsub() {
                const cover = watcher.watchers.pop()
                if (cover) {
                    watcher.watchers[index] = cover
                }
            }
            return function() {
                watcher.watchers[index] = noop
                // This ensures we don't unsubscribe while running
                // a foreach statement over the watchers array.
                setTimeout(unsub, 0)
            }
        }
    }
}

export function getNewestProfileVersion(userID: string) {
    return getProfileWatcher(userID).version
}

const EXIF_TAG = 'eXIf'

export async function insertProfile(userID: string, profileData: ImageEmbeddedProfile, key: CryptoKey, chain: ArrayBuffer, image: ArrayBuffer = PROFILE_NO_IDAT) {
    // TODO: CryptoKey might be a bad type depending on usage

    const encoder = new TextEncoder()
    const profileDataJSON = JSON.stringify(profileData)
    const profileDataArray = encoder.encode(profileDataJSON)

    const chunks = decodePNG(image)
    const iend = popTag('IEND', chunks)
    const newChunks = chunks.filter(c => c.tag !== PROFILE_DATA_TAG &&
                                         c.tag !== PROFILE_SIGNATURE_TAG &&
                                         c.tag !== PROFILE_CHAIN_TAG &&
                                         c.tag !== EXIF_TAG)

    newChunks.push({
        tag: PROFILE_CHAIN_TAG,
        data: new Uint8Array(chain)
    })

    newChunks.push({
        tag: PROFILE_DATA_TAG,
        data: profileDataArray
    })

    const signedRegion = encodePNG(newChunks)
    console.log('signedRegion in insertProfile:', signedRegion)
    const signature = await crypto.subtle.sign(DEFAULT_SIGN_ALGORITHM, key, signedRegion)
    newChunks.push({
        tag: PROFILE_SIGNATURE_TAG,
        data: new Uint8Array(signature)
    })

    newChunks.push(iend)

    const newArrayBuffer = encodePNG(newChunks)
    const objectURL = URL.createObjectURL(new Blob([newArrayBuffer]))
    const profileTimestamp = profileData.timestamp
    profiles[userAndTimestamp(userID, profileTimestamp)] = Promise.resolve({
        profileData,
        arrayBuffer: newArrayBuffer,
        objectURL,
        missingIDAT: isMissingIDAT(newChunks),
        references: 0,
    })
    notifyProfileWatchers(userID, profileTimestamp)
}

; (window as any).debugProfiles = profiles
