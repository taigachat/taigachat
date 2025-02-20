// TODO: come up with a better name.

import { actionsData, authFailure } from "./schema";
import type { ActionRequest, AuthFailure, CombinedAuthMethod } from "./schema";
import type { ActionsKey, ActionData, MainAuthMethod } from "./schema";
import {
    UNLOADED_SERVER_LIST,
    type ClientUser,
    type ListedServer,
    type MainStore,
    type Toast,
} from "./store";
import type { Immutable } from "./immutable";
import { isDeveloper, appVersion } from "./options";
import { safeURL } from "./join_url";
import { addToast, dismissToast, setServerConnectivityInfoTokenAndID } from "./acts";
import { generateProofForServer } from "./auth";
import type { SavedMainAuth } from "./auth_methods";
import { fromBase64, toBase64 } from "./encoding_schemes";

/*
const volatile = {
    userIsActive0: true,
};
*/

let clientUsers: Immutable<Record<string, ClientUser>> = {};

let listedServers: Immutable<Record<string, ListedServer>> = UNLOADED_SERVER_LIST;

let toasts: Immutable<Toast[]>;

export async function handleStoreChanged(store: Immutable<MainStore>) {
    listedServers = store.listedServers;
    clientUsers = store.clientUsers;
    toasts = store.toasts;
}

export function getServerAuthenticatedURL(connectivityInfo: ListedServer, endpoint: string) {
    const developer = isDeveloper ? "&isDeveloper=1" : "";
    const path = `${endpoint}?token=${connectivityInfo.sessionToken}&device=${connectivityInfo.deviceID}&id=${connectivityInfo.sessionID}&appVersion=${appVersion}${developer}`;
    return safeURL(connectivityInfo.url)(path);
}

async function createMainAuthMethod(
    localID: string,
    stored: SavedMainAuth,
    authFailure: AuthFailure
): Promise<MainAuthMethod> {
    if ("ecdsaIdentity" in stored) {
        const { encryptedIdentityKey, encryptedIdentityKeyIV, publicKeyRaw } = stored.ecdsaIdentity;
        const proof = await generateProofForServer(
            localID,
            encryptedIdentityKey,
            encryptedIdentityKeyIV,
            authFailure.nonce
        );
        if (proof) {
            return {
                expectedAuthID: "ecid1-" + publicKeyRaw,
                ecdsaIdentity: {
                    publicKeyRaw,
                    signedNonce: proof,
                },
            };
        }
    }
    if ("guest" in stored) {
        const guise = new Uint8Array(fromBase64(stored.guest.identifier));
        const publicSalt = new Uint8Array(fromBase64(authFailure.publicSalt));
        const arrayBuffer = new Uint8Array(publicSalt.length + guise.length);
        arrayBuffer.set(publicSalt, 0);
        arrayBuffer.set(guise, publicSalt.length);
        const hashedString = toBase64(
            await crypto.subtle.digest(
                {
                    name: "SHA-384",
                },
                arrayBuffer
            )
        );

        return {
            expectedAuthID: "anon384-" + hashedString,
            guest: {
                identifier: stored.guest.identifier,
            },
        };
    }
    if ("missing" in stored) {
        throw "the client user is missing a proper auth method";
    }

    throw "unsupported main auth method selected";
}

/*
async function createExtraSecurityMethod(stored: SavedExtraSecurity): Promise<ExtraSecurityMethod> {
    // TODO: Not called yet.
    throw "unsupported extra security method";
}
*/

async function createCombinedAuthMethod(
    _serverID: string,
    localUserID: string,
    clientUsers: Immutable<Record<string, ClientUser>>,
    authFailure: AuthFailure
) {
    // TODO: Check serverID for exclusivity of clientUser

    const previousIdentifiers: MainAuthMethod[] = [];
    let clientUser = clientUsers[localUserID];
    if (clientUser === undefined) {
        throw "no user select for this server";
    }
    while (clientUser && clientUser.supersededBy !== "") {
        const nextUser: Immutable<ClientUser | undefined> = clientUsers[clientUser.supersededBy];
        if (nextUser === undefined) {
            break;
        }
        try {
            previousIdentifiers.push(
                await createMainAuthMethod(clientUser.localID, clientUser.mainIdentifier, authFailure)
            );
        } catch (e) {
            console.error("error while authenticating previous identifier:");
            console.error(e); // TODO: Report in a better way
        }
        clientUser = nextUser;
    }

    const combinedAuthMethod: CombinedAuthMethod = {
        mainIdentifier: await createMainAuthMethod(
            clientUser.localID,
            clientUser.mainIdentifier,
            authFailure
        ),
        extraSecurity: [], // TODO: Add back.
        transferIdentifiers: previousIdentifiers,
    };

    return combinedAuthMethod;
}

export class ActionError {
    text: string;
    constructor(text: string) {
        this.text = text;
    }
}

async function addErrorToast(serverID: string, text: string) {
    let toastCount = 0;
    let firstToast = "";
    for (const toast of toasts) {
        if (toast.serverID === serverID) {
            toastCount++;
            firstToast ||= toast.id;
        }
    }
    if (toastCount >= 5) {
        await dismissToast(firstToast);
    }

    await addToast({
        title: `Server #${serverID}`,
        id: `feedback-${serverID}-${Date.now()}`,
        serverID: serverID,
        color: "error",
        text,
    });
}

type OnServerActions = {
    [ActionName in ActionsKey]: (serverID: string, ...data: ActionData<ActionName>) => Promise<void>;
};

export const onServer: OnServerActions = {} as OnServerActions;

// TODO: Maybe instead of throwing, we could return true/false?

async function performAction(
    serverID: string,
    actionName: string,
    data: unknown[],
    connectivityInfo: ListedServer
) {
    const url = getServerAuthenticatedURL(connectivityInfo, `action/${actionName}`);
    const typedBody: ActionRequest = {
        args: data,
    };
    let response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(typedBody),
    });
    if (response.status === 401) {
        const failure = authFailure.parse(await response.json());

        let auth: CombinedAuthMethod;
        try {
            auth = await createCombinedAuthMethod(
                serverID,
                connectivityInfo.localUserID,
                clientUsers,
                failure
            );
        } catch (e) {
            if (typeof e === "string") {
                addErrorToast(serverID, e); // TODO: Are we handling this right?
                return;
            } else {
                throw e;
            }
        }

        const newTypedBody: ActionRequest = {
            args: data,
            auth,
        };

        response = await fetch(url, {
            method: "POST",
            body: JSON.stringify(newTypedBody),
        });
    }
    if (response.ok) {
        const json = await response.json();
        const token = json.token;
        if (typeof token !== "string") {
            throw new Error("expected session token from server but did not get one"); // TODO: Handle better
        }
        const id = json.id;
        if (typeof id !== "string") {
            throw new Error("expected session ID from server but did not get one"); // TODO: Handle better
        }

        await setServerConnectivityInfoTokenAndID(serverID, id, token);
    } else {
        const text = await response.text();
        console.log(text);
        throw new ActionError(text);
    }
}

for (const actionName in actionsData) {
    onServer[actionName as ActionsKey] = async (serverID: string, ...data) => {
        const listedServer = listedServers[serverID];
        if (listedServer === undefined || !listedServer.enabled) {
            return;
        }
        try {
            await performAction(serverID, actionName, data, listedServer);
        } catch (e) {
            // TODO: Report in a better way
            console.error(`error on server ${serverID}`);
            if (e instanceof ActionError) {
                addErrorToast(serverID, e.text);
            }
            throw e;
        }
    };
}
