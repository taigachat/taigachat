import { getCentralURL } from "./urls";
import { fromBase64, toBase64 } from "./encoding_schemes";
import type { EndToEndEncryptionKey } from "./store";
import { registerDebugCommand } from "./debug_mode";

// Normal login flow:
// 1. Enter username and password.
// 2. Request salt & timestamp from server.
// 3. Generate central proof (like a password).
// 4. Create a user with useCentral
// ... Later auth.ts detects that the user does not have a StandardAuthMethod:
// 5. Request passphrase
// 6. Generate EC key and store as StandardAuthMethod encrypted using clientKey (if ther is one)

// Normal server connection:
// 1. Ask for clientKey (if there is one - store for 15 min)
// 1. Decrypt EC key using clientKey
// 2. Sign nonce using EC key

let authWorker: Worker | undefined = undefined;

type SaveClientKeyAct = (
    localID: string,
    username: string,
    saveEncryptedKey: string,
    keyIV: string,
    publicRaw: string
) => void;
let saveClientKeyAct: SaveClientKeyAct = (localID, username, saveEncryptedKey, keyIV, publicRaw) => {
    console.error("could not save encrypted key:", localID, username, saveEncryptedKey, keyIV, publicRaw);
};

type SaveEndToEndKeyAct = (
    fingerprint: string,
    saveEncryptedEndToEndKey: string,
    keyIV: string,
    salt: string
) => void;
let saveEndToEndKeyAct: SaveEndToEndKeyAct = (fingerprint, saveEncryptedEndToEndKey, keyIV, salt) => {
    console.error("could not save encrypted e2e key:", fingerprint, saveEncryptedEndToEndKey, keyIV, salt);
};

export function setSaveKeyActions(
    newSaveClientKeyAct: SaveClientKeyAct,
    newSaveEndToEndKeyAct: SaveEndToEndKeyAct
) {
    saveClientKeyAct = newSaveClientKeyAct;
    saveEndToEndKeyAct = newSaveEndToEndKeyAct;
}

function randomAuthMessage(e: MessageEvent<Record<string, string | ArrayBuffer | Uint8Array>>) {
    // Such a message can come at any time from a auth worker.
    // Right now, this is mostly to inform the rest of the client that
    // the auth worker has finished computing an identity key.

    if ("saveEncryptedKey" in e.data) {
        const { localID, username, saveEncryptedKey, encryptionIV, publicRaw } = e.data;
        if (
            typeof localID !== "string" ||
            typeof username !== "string" ||
            !(publicRaw instanceof ArrayBuffer) ||
            !(saveEncryptedKey instanceof ArrayBuffer) ||
            !(encryptionIV instanceof Uint8Array)
        ) {
            return;
        }
        saveClientKeyAct(
            localID,
            username,
            toBase64(saveEncryptedKey),
            toBase64(encryptionIV.buffer),
            toBase64(publicRaw)
        );
    } else if ("saveEncryptedEndToEndKey" in e.data) {
        const { saveEncryptedEndToEndKey, encryptionIV, fingerprint, salt } = e.data;
        if (
            typeof fingerprint !== "string" ||
            typeof salt !== "string" ||
            !(saveEncryptedEndToEndKey instanceof ArrayBuffer) ||
            !(encryptionIV instanceof Uint8Array)
        ) {
            return;
        }
        saveEndToEndKeyAct(
            fingerprint,
            toBase64(saveEncryptedEndToEndKey),
            toBase64(encryptionIV.buffer),
            salt
        );
    }
}

function getAuthWorker(): Worker {
    if (authWorker) {
        return authWorker;
    }
    const newWorker = new Worker("./static/auth-worker.js");
    newWorker.addEventListener("message", randomAuthMessage);
    authWorker = newWorker;
    return newWorker;
}

type MessageToWorker = Record<string, string | number | ArrayBuffer>;
type MessageFromWorker = string | ArrayBuffer | CryptoKey;

function sendWorkerMessageUntyped(name: string, msg: MessageToWorker) {
    const channel = new MessageChannel();
    const port1 = channel.port1;
    const p = new Promise((ok: (_: MessageFromWorker) => void, err) => {
        port1.start();
        port1.addEventListener("message", function (e) {
            port1.close();
            const d = e.data;
            if ("error" in d && typeof d.error === "string") {
                err(new Error(d.error)); // TODO: Maybe use better type
            } else if (
                "ok" in d &&
                (d.ok instanceof ArrayBuffer || d.ok instanceof CryptoKey || typeof d.ok === "string")
            ) {
                ok(d.ok);
            } else {
                err("worker response not correct");
            }
        });
    });
    getAuthWorker().postMessage({ name, msg, port: channel.port2 }, [channel.port2]);
    return p;
}

async function sendWorkerMessageGetString(name: string, msg: MessageToWorker) {
    const response = await sendWorkerMessageUntyped(name, msg);
    if (typeof response === "string") {
        return response;
    } else if (response instanceof ArrayBuffer) {
        return toBase64(response);
    } else {
        throw "expected a string or ArrayBuffer but got something else";
    }
}

async function sendWorkerMessageGetKey(name: string, msg: MessageToWorker) {
    const response = await sendWorkerMessageUntyped(name, msg);
    if (response instanceof CryptoKey) {
        return response;
    } else {
        throw "expected a CryptoKey but got something else";
    }
}

export function loginUserUsingCentral(localID: string, username: string, password: string): Promise<string> {
    const centralURL = getCentralURL();

    return sendWorkerMessageGetString("loginCentralUser", { localID, centralURL, username, password });
}

export function registerUserUsingCentral(
    localID: string,
    username: string,
    password: string
): Promise<string> {
    const centralURL = getCentralURL();

    return sendWorkerMessageGetString("registerCentralUser", {
        localID,
        centralURL,
        username,
        password,
        wordCount: 24,
    });
}

export async function generateProofForServer(
    localID: string,
    encryptedKey: string,
    encryptedKeyIV: string,
    nonce: string
) {
    const signature = await sendWorkerMessageGetString("generateProofForServer", {
        localID,
        encryptedKey: fromBase64(encryptedKey),
        encryptedKeyIV: fromBase64(encryptedKeyIV),
        nonce,
    });

    if (signature == "") {
        return undefined;
    }

    return signature;
}

export async function signProfilePicture(
    localID: string,
    encryptedKey: string,
    encryptedKeyIV: string,
    profile: ArrayBuffer
) {
    const signature = await sendWorkerMessageGetString("generateSignatureForProfile", {
        localID,
        encryptedKey: fromBase64(encryptedKey),
        encryptedKeyIV: fromBase64(encryptedKeyIV),
        profile,
    });

    if (signature == "") {
        return undefined;
    }

    return signature;
}

export async function encryptEndToEndKey(password: string, salt: string, expectedFingerprint: string) {
    return await sendWorkerMessageGetString("encryptEndToEndKey", {
        password,
        salt,
        expectedFingerprint,
    });
}

export async function decryptEndToEndKey(encryptedEndToEndKey: EndToEndEncryptionKey) {
    return await sendWorkerMessageGetKey("decryptEndToEndKey", {
        salt: encryptedEndToEndKey.salt,
        fingerprint: encryptedEndToEndKey.fingerprint,
        encryptedKey: fromBase64(encryptedEndToEndKey.encryptedKey),
        iv: fromBase64(encryptedEndToEndKey.iv),
    });
}

export function isForbiddenUsername(username: string) {
    return /[ /@:\s+&=?#%<>[\]{}|\\^]/gi.test(username);
}

registerDebugCommand("authWorker", getAuthWorker);
registerDebugCommand("loginUserUsingCentral", loginUserUsingCentral);
registerDebugCommand("registerUserUsingCentral", registerUserUsingCentral);
registerDebugCommand("generateProofForServer", generateProofForServer);
registerDebugCommand("encryptedEndToEndKey", encryptEndToEndKey);
