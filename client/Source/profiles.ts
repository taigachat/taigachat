// TODO: Implement a gossip protocol for the propagation of newer profile pictures.

//import { exportAsSHA512, importPKCS7, verifyX509Chain } from './x509_chains'
import { encodePNG, decodePNG, findChunkByTag } from "./png";
import type { PNGChunk } from "./png";
import { imageEmbeddedProfile, ECDSA_IDENTITY_ALGORITHM, PROFILE_SIGN_ALGORITHM } from "./schema";
import type { ImageEmbeddedProfile, ServerUser } from "./schema";
import type { Immutable } from "./immutable";
import { fromBase64, toBase64 } from "./encoding_schemes";
import type { SavedMainAuth } from "./auth_methods";
import { signProfilePicture } from "./auth";

import { writable } from "svelte/store";
import { registerDebugCommand } from "./debug_mode";

const PROFILE_DATA_TAG = "tpRF";
const PROFILE_SIGNATURE_TAG = "tsIG";
const PROFILE_KEY_TAG = "tkEY";

// Used to identify that a profile was signed locally
const LOCAL_SIGNING_ID = "LOCAL_SIGNING_ID";

export const VALID_PROFILE_START_DATE = 1693200000;

// Incremented anytime a profile is loaded.
export const profilesModified = writable(0);
export const localProfilesModified = writable(0);

export enum ProfileFlags {
    none = 0,
    missingIDAT = 1,
    verified = 2,
}

export enum ProfileState {
    /** The lazy loading of this profile has not begun yet. */
    UNLOADED,

    /** The profile has been requested but the loading is not done yet. */
    LOADING,

    /** We have found and loaded the correct profile. */
    LOADED,

    /** Something went wrog while loading the profile. */
    FAILED,
}

export interface Profile {
    displayedName: string;
    displayedAvatar: string;

    /** Call this to start a load of this particular profile version. */
    load: () => void;

    profileData: ImageEmbeddedProfile;
    signingID: string;
    objectURL: string;
    arrayBuffer: ArrayBuffer;
    flags: ProfileFlags;
    state: ProfileState;
    error: string;
}

/** Maps server ID then userID + timestamp to a profile. */
const profilesPerServer: Map<string, Map<string, Profile>> = new Map();

/**
 * Profiles that belong to a user which is logged onto this client.
 * The profile is not necessarily uploaded to any server.
 * Maps local ID to a profile.
 */
const localNewestProfiles: Map<string, Profile> = new Map();

type ProfileFetcher = (
    serverID: string,
    userID: string,
    profileTimestamp: number
) => Promise<Blob | undefined>;
const profileFetchers: Map<string, ProfileFetcher> = new Map();
export function setProfileFetcher(serverID: string, loader: ProfileFetcher) {
    profileFetchers.set(serverID, loader);
}

/** Returns true if the last chunk matches the tag */
function peekTag(tag: string, chunks: PNGChunk[]) {
    const peek = chunks[chunks.length - 1];
    return peek !== undefined && peek.tag === tag;
}

/** Pops a chunk but only if the tag matches */
function popTag(tag: string, chunks: PNGChunk[]) {
    const peek = chunks[chunks.length - 1];
    if (peek === undefined) {
        throw "could not find " + tag;
    }
    if (peek.tag !== tag) {
        throw `tag name missmatch: ${peek.tag}, expected: ${tag}`;
    }
    chunks.pop();
    return peek;
}

function isMissingIDAT(chunks: PNGChunk[]) {
    return chunks.find((c) => c.tag === "IDAT") === undefined;
}

const PROFILE_NO_IDAT = fromBase64("iVBORw0KGgoAAAAASUVORK5CYII");
registerDebugCommand("profileNoIDAT", () => PROFILE_NO_IDAT);

const MISSING_PROFILE = new URL("/static/missing_avatar.svg", import.meta.url).href;
const MISSING_PROFILE_WITH_HASH = MISSING_PROFILE + "#";
let incrementingID = 0;

function noop() {}

function defaultProfile(fallbackName: string) {
    return {
        displayedName: fallbackName,
        displayedAvatar: MISSING_PROFILE_WITH_HASH + incrementingID++,
        load: noop,
        profileData: {
            userName: fallbackName,
            timestamp: 0,
        },
        signingID: "",
        arrayBuffer: PROFILE_NO_IDAT,
        objectURL: "",
        flags: ProfileFlags.missingIDAT,
        state: ProfileState.UNLOADED,
        error: "",
    };
}

/**
 * Finds a profile in the profile cache, or inserts a default.
 * But does NOT start fetch if one is missing.
 */
export function getServerProfile(
    serverID: string,
    userID: string,
    user: Immutable<ServerUser> | undefined,
    _profilesModified?: number
): Profile {
    // _profilesModified is deliberately ignored and only passed as a
    // parameter in order to trick Svelte into causing a re-calculation.
    // Note that re-calculation does not imply re-render as it does not
    // always perform deep equality checks on objects.
    // Since changes to profiles are done in-place it is recommended to
    // use profilesModified in the rendering code (perhaps using #key) as well.

    const profileTimestamp = user ? user.profileTimestamp : 0;
    let profilesInServer = profilesPerServer.get(serverID);
    if (profilesInServer === undefined) {
        profilesInServer = new Map();
        profilesPerServer.set(serverID, profilesInServer);
    }

    const nameInCache = `${userID}/${profileTimestamp}`;
    const oldProfile = profilesInServer.get(nameInCache);
    if (oldProfile !== undefined) {
        return oldProfile;
    }

    const profile = defaultProfile(userID);

    // Only if a user object is passed do we know how to perform a load.
    profile.load = user
        ? () =>
              profile && profile.state === ProfileState.UNLOADED && loadServerProfile(serverID, profile, user)
        : noop;
    profilesInServer.set(nameInCache, profile);

    return profile;
}

async function loadServerProfile(
    serverID: string,
    profile: Profile,
    user: Immutable<ServerUser>
): Promise<void> {
    console.log("load profile from server:", user);

    if (profile.state !== ProfileState.UNLOADED) {
        // Loading has already begun.
        return;
    }

    const profileFetcher = profileFetchers.get(serverID);

    if (user.profileTimestamp === 0 || profileFetcher === undefined) {
        // There is no way to load such a profile.
        profile.state = ProfileState.FAILED;
        return;
    }

    // Make sure that nobody else attempts to run the code below at the same time as us.
    profile.state = ProfileState.LOADING;

    // Fetch and decode.
    const data = await profileFetcher(serverID, user.userID, user.profileTimestamp);
    if (data === undefined) {
        // TODO: Maybe we should try again sometime.
        profile.state = ProfileState.FAILED;
        return;
    }
    const arrayBuffer = await data.arrayBuffer();
    const chunks = decodePNG(arrayBuffer);

    popTag("IEND", chunks);

    const profileChunk = findChunkByTag(PROFILE_DATA_TAG, chunks);
    const decoder = new TextDecoder();
    const profileText = decoder.decode(profileChunk.data);
    const profileData = imageEmbeddedProfile.parse(JSON.parse(profileText));

    if (profileData.timestamp !== user.profileTimestamp) {
        // TODO: Refactor error setting into a function, also set displayedAvatar into an error profile picture
        profile.state = ProfileState.FAILED;
        profile.error = "timestamp does not match";
        return;
    }

    // The following steps verify the profile.
    let signingID = "";
    try {
        if (!peekTag(PROFILE_SIGNATURE_TAG, chunks)) {
            profile.state = ProfileState.FAILED;
            profile.error = "no signature tag";
            return;
        }

        const signatureChunk = popTag(PROFILE_SIGNATURE_TAG, chunks);
        const signedRegion = new Uint8Array(arrayBuffer, 0, signatureChunk.data.byteOffset - 8);
        console.log("signedRegion:", signedRegion);

        const keyChunk = findChunkByTag(PROFILE_KEY_TAG, chunks);

        //// TODO: Remove the import
        //const certificates = importPKCS7(chainChunk.data)

        //// TODO: Really, we only need to verify all the sessions up to the user
        //// certificate. And new profiles don't need to contain the entire chain
        //// for that reason.
        //const analysis = await verifyX509Chain(certificates)

        //const key = await exportAsSHA512(analysis.publicSessionKey, 'verify')

        const key = await crypto.subtle.importKey("raw", keyChunk.data, ECDSA_IDENTITY_ALGORITHM, false, [
            "verify",
        ]);

        // TODO: At some point, we should make sure crypto.subtle only exists in x509_chains and user_chains.ts
        const verification = await crypto.subtle.verify(
            PROFILE_SIGN_ALGORITHM,
            key,
            signatureChunk.data,
            signedRegion
        );
        if (!verification) {
            profile.state = ProfileState.FAILED;
            profile.error = "could not verify image";
            return;
        }

        const expectedSigningID = toBase64(keyChunk.data);

        for (const identity of user.identities) {
            if ("ecdsaIdentity" in identity) {
                const possibleID = identity.ecdsaIdentity.publicKeyRaw;
                if (possibleID === expectedSigningID) {
                    signingID = expectedSigningID;
                }
            }
        }
    } catch (e) {
        profile.state = ProfileState.FAILED;
        profile.error = `could not verify profile ${user} ${e}`;
        return;
    }

    // TODO: Actually delete somewhere
    const objectURL = URL.createObjectURL(data);

    const missingIDAT = isMissingIDAT(chunks);

    profile.profileData = profileData;
    profile.signingID = signingID;
    profile.arrayBuffer = arrayBuffer;
    profile.objectURL = objectURL;
    profile.flags =
        (missingIDAT ? ProfileFlags.missingIDAT : 0) | (signingID !== "" ? ProfileFlags.verified : 0);
    profile.displayedName = profileData.userName;
    profile.displayedAvatar = missingIDAT ? MISSING_PROFILE : objectURL;
    profile.state = ProfileState.LOADED;

    // Notify everyone.
    profilesModified.update((v) => v + 1);

    console.log("done loading profile:", profile);

    return;
}

export function getLocalProfile(localID: string, _localProfilesModified?: number): Profile {
    // The reasoning behind the _localProfilesModified is that it can be used to
    // trick Svelte into doing a re-calculation,
    // see the note for _profilesModified above.

    const existingLocalProfile = localNewestProfiles.get(localID);
    if (existingLocalProfile) {
        return existingLocalProfile;
    }
    const localProfile = defaultProfile(localID);
    localNewestProfiles.set(localID, localProfile);
    return localProfile;
}

export async function fetchLocalProfile(localID: string, serverID: string, user: ServerUser) {
    try {
        // We load remote profile first as that is async and can interrupt the code flow.
        const newProfile = getServerProfile(serverID, user.userID, user);
        await loadServerProfile(serverID, newProfile, user);

        // Now we can decide if the replacment will happen safely.
        const oldLocal = getLocalProfile(localID);

        const oldTimestamp = oldLocal.profileData.timestamp;
        const newTimestamp = newProfile.profileData.timestamp;
        if (oldTimestamp >= newTimestamp) {
            // No need to update to an older version...
            return;
        }
        if (newTimestamp < VALID_PROFILE_START_DATE) {
            // Any profile created before 28th of August 2023, is not
            // a valid replacement for the current local profile.
        }

        // It was newer, so we replace.
        localNewestProfiles.set(localID, newProfile);

        // Notifiy everyone.
        localProfilesModified.update((v) => v + 1);
    } catch (e) {
        console.error("error while loading profile for:", user, e);
    }
}

/*
function shortenAuthID(id: string) {
    return `${id.substring(0, 10)}[...]${id.slice(-10)}`
}
*/

// TODO: Implement sweeper that runs whenever we try to load something else

const EXIF_TAG = "eXIf";

export async function insertLocalProfile(
    localID: string,
    profileData: ImageEmbeddedProfile,
    mainAuth: SavedMainAuth,
    image: ArrayBuffer = PROFILE_NO_IDAT
) {
    // TODO: CryptoKey might be a bad type depending on usage

    const encoder = new TextEncoder();
    const profileDataJSON = JSON.stringify(profileData);
    const profileDataArray = encoder.encode(profileDataJSON);

    const chunks = decodePNG(image);
    const iend = popTag("IEND", chunks);
    const newChunks = chunks.filter(
        (c) =>
            c.tag !== PROFILE_DATA_TAG &&
            c.tag !== PROFILE_SIGNATURE_TAG &&
            c.tag !== PROFILE_KEY_TAG &&
            c.tag !== EXIF_TAG
    );

    if (!("ecdsaIdentity" in mainAuth)) {
        throw "only ecdsaIdentity accounts support changing profile data currently";
    }

    const { encryptedIdentityKey, encryptedIdentityKeyIV, publicKeyRaw } = mainAuth.ecdsaIdentity;

    newChunks.push({
        tag: PROFILE_KEY_TAG,
        data: new Uint8Array(fromBase64(publicKeyRaw)),
    });

    newChunks.push({
        tag: PROFILE_DATA_TAG,
        data: profileDataArray,
    });

    const signedRegion = encodePNG(newChunks);
    console.log("signedRegion in insertProfile:", signedRegion);

    const signature64 = await signProfilePicture(
        localID,
        encryptedIdentityKey,
        encryptedIdentityKeyIV,
        signedRegion
    );
    if (signature64 === undefined) {
        throw "failed to sign profile";
    }
    const signature = fromBase64(signature64);
    //const signature = await crypto.subtle.sign(PROFILE_SIGN_ALGORITHM, key, signedRegion)

    newChunks.push({
        tag: PROFILE_SIGNATURE_TAG,
        data: new Uint8Array(signature),
    });

    newChunks.push(iend);

    const missingIDAT = isMissingIDAT(newChunks);

    const newArrayBuffer = encodePNG(newChunks);
    // TODO: Actually delete somewhere
    const objectURL = URL.createObjectURL(new Blob([newArrayBuffer]));
    const profile: Profile = {
        state: ProfileState.LOADED,
        displayedName: profileData.userName,
        displayedAvatar: missingIDAT ? MISSING_PROFILE : objectURL,
        profileData,
        arrayBuffer: newArrayBuffer,
        signingID: LOCAL_SIGNING_ID,
        objectURL,
        load: noop,
        flags: (missingIDAT ? ProfileFlags.missingIDAT : 0) | ProfileFlags.verified,
        error: "",
    };
    const local = getLocalProfile(localID);
    console.log(local);

    localNewestProfiles.set(localID, profile);

    // Notify everyone.
    localProfilesModified.update((v) => v + 1);

    console.log("profileModified should have changed");
}

registerDebugCommand("profilesModified", () => profilesModified);
registerDebugCommand("profiles", () => profilesPerServer);
