/// <reference lib="webworker" />

// TODO: Really, this worker should be called security-worker.js and auth.ts should be renamed to security.js

/** @type {CryptoKey|undefined} */
var masterKey = undefined;

const ECDSA_ALG = {
    /** @type {'ECDSA'} */
    name: "ECDSA",

    /** @type {'P-384'} */
    namedCurve: "P-384",
};

/**
 * Right now, it just returns a dummy key.
 * @returns {Promise<CryptoKey>}
 */
async function getMasterKey() {
    if (masterKey !== undefined) {
        return masterKey;
    }

    // TODO: Generate a random key and store it using WebAuthn largeBlob
    // Or alternatively ask the launcher
    const newMasterKey = await crypto.subtle.importKey(
        "jwk",
        {
            alg: "A256GCM",
            ext: true,
            k: "w1xWVks5v9FkmSm-SYGqJLxiw2BHcsEG6_BCOLItxco",
            key_ops: ["wrapKey", "unwrapKey"],
            kty: "oct",
        },
        "AES-GCM",
        false,
        ["wrapKey", "unwrapKey"]
    );

    return newMasterKey;
}

// TODO: Evict keys after going unused for a while.
/** @type {Map<string, Promise<CryptoKey>>} */
var loadedKeys = new Map();

/**
 * Encrypts the key, then sends it off to the main thread for storage.
 * @param {string} localID
 * @param {string} username
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} publicKey
 */
async function encryptAndSendKey(localID, username, privateKey, publicKey) {
    const wrappingKey = await getMasterKey();
    const encryptionIV = new Uint8Array(12);
    crypto.getRandomValues(encryptionIV);
    const encryptedKey = await crypto.subtle.wrapKey("jwk", privateKey, wrappingKey, {
        name: "AES-GCM",
        iv: encryptionIV,
    });

    const publicRaw = await crypto.subtle.exportKey("raw", publicKey);

    self.postMessage({ localID, username, saveEncryptedKey: encryptedKey, encryptionIV, publicRaw });
}

/**
 * Called by getIdentityKey() if a key needs to be decrypted.
 * @param {Uint8Array} encryptedKey
 * @param {Uint8Array} encryptedKeyIV
 * @returns {Promise<CryptoKey>}
 */
async function startDecryptKey(encryptedKey, encryptedKeyIV) {
    const unwrappingKey = await getMasterKey();
    const decryptedKey = await crypto.subtle.unwrapKey(
        "jwk",
        encryptedKey,
        unwrappingKey,
        {
            name: "AES-GCM",
            iv: encryptedKeyIV,
        },
        ECDSA_ALG,
        false,
        ["sign"]
    );

    return decryptedKey;
}

/**
 * Decrypts key if necessary, otherwise just return
 * the loaded key for the user with the local ID.
 * @param {string} localID
 * @param {Uint8Array|undefined} encryptedKey
 * @param {Uint8Array|undefined} encryptedKeyIV
 * @returns {Promise<CryptoKey|undefined>}
 */
function getIdentityKey(localID, encryptedKey, encryptedKeyIV) {
    const possibleKey = loadedKeys.get(localID);
    if (possibleKey !== undefined) {
        return possibleKey;
    }
    if (encryptedKey == undefined || encryptedKeyIV == undefined) {
        // No key is stored, and we have no way of getting one for this user.
        return Promise.resolve(undefined);
    }
    const decryptedKey = startDecryptKey(encryptedKey, encryptedKeyIV);
    loadedKeys.set(localID, decryptedKey);
    return decryptedKey;
}

/**
 * @param {LoadedWebAssembly} wa
 * @param {string} unencrpytedPassword
 * @param {string} salt
 * @param {string} expectedFingerprint
 * @returns {Promise<string>}
 */
async function encryptAndSendEndToEndKey(wa, unencrpytedPassword, salt, expectedFingerprint) {
    const wrappingKey = await getMasterKey();

    const fingerprintHash = await runCommand(
        wa,
        "generateEndToEndKeyFingerprint",
        {
            username: salt,
            password: unencrpytedPassword,
        },
        []
    );

    const endToEndFingerprint = `v1e2e/${fingerprintHash}/${salt}`;

    if (expectedFingerprint && endToEndFingerprint !== expectedFingerprint) {
        return "missmatch";
    }

    const keyMaterial = await runCommand(
        wa,
        "generateEndToEndKey",
        {
            username: salt,
            password: unencrpytedPassword,
        },
        []
    );

    const keyToWrap = await crypto.subtle.importKey(
        "jwk",
        {
            alg: "A256GCM",
            ext: true,
            k: keyMaterial,
            key_ops: ["encrypt", "decrypt"],
            kty: "oct",
        },
        "AES-GCM",
        true,
        ["encrypt", "decrypt"]
    );

    const encryptionIV = new Uint8Array(12);
    crypto.getRandomValues(encryptionIV);

    const encryptedKey = await crypto.subtle.wrapKey("jwk", keyToWrap, wrappingKey, {
        name: "AES-GCM",
        iv: encryptionIV,
    });

    self.postMessage({
        saveEncryptedEndToEndKey: encryptedKey,
        encryptionIV,
        fingerprint: endToEndFingerprint,
        salt,
    });

    return endToEndFingerprint;
}

/**
 * Called by getIdentityKey() if a key needs to be decrypted.
 * @param {Uint8Array} encryptedKey
 * @param {Uint8Array} encryptedKeyIV
 * @returns {Promise<CryptoKey>}
 */
async function decryptEndToEndKey(encryptedKey, encryptedKeyIV) {
    const unwrappingKey = await getMasterKey();
    const decryptedKey = await crypto.subtle.unwrapKey(
        "jwk",
        encryptedKey,
        unwrappingKey,
        {
            name: "AES-GCM",
            iv: encryptedKeyIV,
        },
        {
            name: "AES-GCM",
        },
        false,
        ["encrypt", "decrypt"]
    );

    return decryptedKey;
}

/**
 * @typedef LoadedWebAssembly
 * @type {object}
 * @property {WebAssembly.WebAssemblyInstantiatedSource} wasm
 * @property {WebAssembly.Memory} memory
 * @property {Record<string, number>} inputNames
 */

/** @type {Promise<LoadedWebAssembly>|undefined} */
let wasmLoadPromise = undefined;

const wasmPath = "../out/authenticator.wasm";

// TODO: Shut this worker down after some inactivity. Probably better done in auth.js
// Or, we could use a new WASM for each command. And never shutdown the worker now that getWebAssembly() is decoupled? Or do both.
// TODO: Check if WebAssembly is properly cleaning up the bytes after itself

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @param {string} name
 * @param {LoadedWebAssembly} wa
 * @returns {Function}
 */
function getWasmCallable(wa, name) {
    const wasmCallable = wa.wasm.instance.exports[name];
    if (typeof wasmCallable !== "function") {
        throw name + " is missing";
    }

    return wasmCallable;
}

const EMPTY_MEMORY = { buffer: new ArrayBuffer(0) };

/**
 * @returns {Promise<LoadedWebAssembly>}
 */
function getWebAssembly() {
    if (wasmLoadPromise) {
        return wasmLoadPromise;
    }

    let wasmMemory = EMPTY_MEMORY;

    /** @type {Record<string, number>}*/
    const inputNames = {};

    const waPromise = WebAssembly.instantiateStreaming(fetch(wasmPath), {
        env: {
            /**
             * @param {number} buf
             * @param {number} len
             */
            gen_crypto_numbers(buf, len) {
                console.log("gen_crypto_numbers() called"); // TODO: Remove logs in production for saftey reasons!
                const memory = new Uint8Array(wasmMemory.buffer, buf, len);
                console.log("before: ", memory);
                crypto.getRandomValues(memory);
                console.log("after: ", memory);
            },

            /**
             * @param {number} str
             * @param {number} len
             * @param {number} value
             */
            handle_input_name(str, len, value) {
                const memory = new Uint8Array(wasmMemory.buffer, str, len);
                const name = decoder.decode(memory);
                inputNames[name] = value;
            },

            warn_debug_build() {
                console.warn(`${wasmPath} was compiled using debug mode`);
            },
        },
    });

    async function load() {
        const wa = await waPromise;
        const memory = wa.instance.exports.memory;
        if (!(memory instanceof WebAssembly.Memory)) {
            throw "memory was not of type WebAssembly.Memory";
        }
        wasmMemory = memory;

        /** @type {LoadedWebAssembly} */
        const result = {
            wasm: wa,
            memory,
            inputNames,
        };

        // Make sure we know the correct values for the input enums.
        getWasmCallable(result, "wasmHandshake")();

        return result;
    }

    const p = load();
    wasmLoadPromise = p;
    return p;
}

/**
 * @param {LoadedWebAssembly} wa
 * @param {string} commandName
 * @param {Record<String, String>} parameters
 * @param {BigInt[]} numbers
 * @returns {Promise<string>}
 */
async function runCommand(wa, commandName, parameters, numbers) {
    const commandCallable = getWasmCallable(wa, commandName);
    const createCommand = getWasmCallable(wa, "createCommand");
    const addCommandInput = getWasmCallable(wa, "addCommandInput");
    const readCommand = getWasmCallable(wa, "readCommand");

    const cmd = createCommand();
    if (cmd === 0) {
        throw "createCommand() returned null";
    }

    for (const [parameterName, parameterValue] of Object.entries(parameters)) {
        const parameterLength = parameterValue.length;

        const parameterInt = wa.inputNames[parameterName];
        if (typeof parameterInt !== "number") {
            throw "unknown input " + parameterName;
        }

        // Memory is freed by free'ing the cmd.
        const memPointer = addCommandInput(cmd, parameterInt, parameterLength);
        if (memPointer === 0) {
            throw "addCommandInput() returned null";
        }
        const memView = new Uint8Array(wa.memory.buffer, memPointer, parameterLength);
        encoder.encodeInto(parameterValue, memView);
    }

    const commandResponse = commandCallable(cmd, ...numbers);
    const outputLength = Math.abs(commandResponse);

    const outputPointer = readCommand(cmd);
    if (outputPointer === 0) {
        throw "readCommand() returned null";
    }

    const outputView = new Uint8Array(wa.memory.buffer, outputPointer, outputLength);
    const outputText = decoder.decode(outputView);

    if (commandResponse < 0) {
        throw `${commandName}() ${outputText}`;
    }

    return outputText;
}

/**
 * @returns BigInt
 */
function random64Bits() {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return new DataView(arr.buffer).getBigInt64(0);
}

/**
 * An alternative to safeURL().
 * @param {string} a
 * @param {string} b
 * @returns URL
 */
function joinURL(a, b) {
    const first = new URL(a);
    const withTrailing = first.pathname.endsWith("/") ? first.pathname : `${first.pathname}/`;
    if (b.startsWith("/")) {
        return new URL(b, first);
    } else {
        return new URL(withTrailing + b, first); // TODO: Move fix into safeURL() as well.
    }
}

/**
 * Generates the identity key and places it in the key map.
 * @param {LoadedWebAssembly} wa
 * @param {string} localID
 * @param {string} username
 * @param {string} password
 * @param {string} passphrase
 */
async function generateIdentityKey(wa, localID, username, password, passphrase) {
    const existingKey = loadedKeys.get(localID);
    if (existingKey !== undefined) {
        throw "key already exists for user";
    }

    const jwk = await runCommand(
        wa,
        "generateEcdsaIdentityKey",
        {
            username,
            password,
            serial_and_passphrase: passphrase,
        },
        []
    );

    const jwkJson = JSON.parse(jwk);

    /** @type {JsonWebKey} */
    const publicKeyJWK = jwkJson.publicKey;

    /** @type {JsonWebKey} */
    const privateKeyJWK = jwkJson.privateKey;

    /** @type {KeyUsage[]} */
    const USAGES = ["sign"];

    /** @type {KeyUsage[]} */
    const PUBLIC_USAGES = ["verify"];

    const exportKey = await crypto.subtle.importKey("jwk", privateKeyJWK, ECDSA_ALG, true, USAGES);
    const publicKey = await crypto.subtle.importKey("jwk", publicKeyJWK, ECDSA_ALG, true, PUBLIC_USAGES);
    const useKey = await crypto.subtle.importKey("jwk", privateKeyJWK, ECDSA_ALG, false, USAGES);

    loadedKeys.set(localID, Promise.resolve(useKey));
    encryptAndSendKey(localID, username, exportKey, publicKey);
}

/**
 * Fetches the passphrase from the central server, then
 * generates an identity key based on it.
 * @param {LoadedWebAssembly} wa
 * @param {string} jwt
 * @param {string} localID
 * @param {string} centralURL
 * @param {string} username
 * @param {string} password
 */
async function passphraseThenGenerateIdentityKey(wa, jwt, localID, centralURL, username, password) {
    const passphraseQuery = new URLSearchParams();
    passphraseQuery.append("token", jwt);
    const passphraseURL = joinURL(centralURL, `./user/passphrase/latest?${passphraseQuery}`);
    const passphrase = await (await fetch(passphraseURL)).json();
    generateIdentityKey(wa, localID, username, password, passphrase);
}

/**
 * Throw if this assertion fails.
 * @param {string} localID
 */
function assertUnassignedLocalID(localID) {
    if (loadedKeys.has(localID)) {
        throw "each local ID must only be assigned once";
    }
}

/**
 * @param {string} cmd
 * @param {any} msg
 * @returns {Promise<string|ArrayBuffer|CryptoKey>}
 */
async function handleAuthCommand(cmd, msg) {
    const wa = await getWebAssembly();
    if (cmd == "loginCentralUser") {
        const { localID, centralURL, username, password } = msg;
        assertUnassignedLocalID(localID);

        const saltQuery = new URLSearchParams();
        saltQuery.append("username", username);
        const seedAndTimestampURL = joinURL(centralURL, `./user/salt?${saltQuery}`);
        const seedAndTimestampResponse = await (await fetch(seedAndTimestampURL)).json();
        if (typeof seedAndTimestampResponse === "string") {
            throw seedAndTimestampResponse;
        }
        const { salt, timestamp } = seedAndTimestampResponse;
        if (typeof salt !== "string") {
            throw "salt was not a string";
        }
        if (typeof timestamp !== "number") {
            throw "timestamp was not a number";
        }
        const parsedSalt = BigInt(salt);

        const response = await runCommand(
            wa,
            "generateProofForCentral",
            {
                username,
                password,
            },
            [BigInt(timestamp), parsedSalt]
        );

        const loginQuery = new URLSearchParams();
        loginQuery.append("username", username);
        loginQuery.append("password", response);
        const loginURL = joinURL(centralURL, `./user/login?${loginQuery}`);
        const loginResponse = await fetch(loginURL);
        if (loginResponse.ok) {
            const jwt = await loginResponse.json();

            // TODO: Handle throws from the following async.
            // We run this in the background such that the
            // identity will already have been generated once it is needed.
            passphraseThenGenerateIdentityKey(wa, jwt, localID, centralURL, username, password);

            return jwt;
        } else {
            const err = await loginResponse.json();
            throw err;
        }
    } else if (cmd === "registerCentralUser") {
        const { localID, centralURL, username, password, wordCount } = msg;
        console.log("central url is:", centralURL);
        assertUnassignedLocalID(localID);

        const freeUsernameQuery = new URLSearchParams();
        freeUsernameQuery.append("username", username);
        const freeUsernameURL = joinURL(centralURL, `./user/salt?${freeUsernameQuery}`);
        let usernameAlreadyTaken = false;
        try {
            const freeUsernameResponse = await fetch(freeUsernameURL);
            if (freeUsernameResponse.ok) {
                // If all goes well, then it means that this user already exists.
                // Let's not waste the users time by generating central-proof for
                // this username & password combo. Instead let the user spend their time
                // coming up with another username.
                usernameAlreadyTaken = true;
            }
        } finally {
            // Keep going no matter what.
        }

        if (usernameAlreadyTaken) {
            throw "username already in use";
        }

        const salt = random64Bits();
        const timestamp = Math.floor(Date.now() / 1000);
        const centralResponse = await runCommand(
            wa,
            "generateProofForCentral",
            {
                username,
                password,
            },
            [BigInt(timestamp), salt]
        );

        const passphraseResponse = await runCommand(
            wa,
            "generateSerialAndPassphrase",
            {
                username,
                password,
            },
            [wordCount, BigInt(timestamp)]
        );

        const registerQuery = new URLSearchParams();
        registerQuery.append("username", username);
        registerQuery.append("password", centralResponse);
        registerQuery.append("passphrase", passphraseResponse);
        registerQuery.append("salt", `${salt}`);
        registerQuery.append("timestamp", `${timestamp}`);
        const registerURL = joinURL(centralURL, `./user/new?${registerQuery}`);
        const registerResponse = await fetch(registerURL);
        if (registerResponse.ok) {
            const jwt = await registerResponse.json();

            // TODO: Handle throws from the following async.
            // We run this in the background such that the
            // identity will already have been generated once it is needed.
            generateIdentityKey(wa, localID, username, password, passphraseResponse);

            return jwt;
        } else {
            const err = await registerResponse.json();
            throw err;
        }
    } else if (cmd === "generateProofForServer") {
        // TODO: Add unit tests for this code to make sure that the server proof stay the same.

        const { localID, encryptedKey, encryptedKeyIV, nonce } = msg;
        const key = await getIdentityKey(localID, encryptedKey, encryptedKeyIV);

        if (key == undefined) {
            // A signature could not be generated.
            return "";
        } else {
            // TaigaChat Server Authentication Nonce
            const prefixedEncoded = encoder.encode("tSAN" + nonce);
            const signature = await crypto.subtle.sign(
                {
                    name: "ECDSA",
                    hash: { name: "SHA-384" },
                },
                key,
                prefixedEncoded
            );
            return signature;
        }
    } else if (cmd === "generateSignatureForProfile") {
        const { localID, encryptedKey, encryptedKeyIV, profile } = msg;
        const key = await getIdentityKey(localID, encryptedKey, encryptedKeyIV);

        const PNG_MAGIC_1 = 0x89504e47;
        const PNG_MAGIC_2 = 0xd0a1a0a;

        const view = new DataView(profile);
        if (view.getUint32(0) !== PNG_MAGIC_1 || view.getUint32(4) !== PNG_MAGIC_2) {
            // If we are not sent a PNG file, then we should refuse to sign.
            // Such that we do not turn into an unwanted oracle.
            throw "bad magic number on PNG";
        }

        if (key == undefined) {
            // A signature could not be generated.
            return "";
        } else {
            // TaigaChat Server Authentication Nonce
            const signature = await crypto.subtle.sign(
                {
                    name: "ECDSA",
                    hash: { name: "SHA-384" },
                },
                key,
                profile
            );
            return signature;
        }
    } else if (cmd === "encryptEndToEndKey") {
        const { password, salt, expectedFingerprint } = msg;
        return await encryptAndSendEndToEndKey(wa, password, salt, expectedFingerprint);
    } else if (cmd === "decryptEndToEndKey") {
        const { salt, fingerprint, encryptedKey, iv } = msg;
        console.log("decrypting", salt, fingerprint);
        // TODO: Decrypt key.
        return await decryptEndToEndKey(encryptedKey, iv);
    } else {
        throw "unknown command " + cmd;
    }
}

/**
 * @param {MessageEvent} event
 */
async function handleAuthMessage(event) {
    const { name, port, msg } = event.data;
    if (!(port instanceof MessagePort)) {
        throw "no port supplied for answer";
    }
    try {
        const response = await handleAuthCommand(name, msg);
        port.postMessage({ ok: response });
    } catch (e) {
        port.postMessage({ error: `${e}` });
    } finally {
        port.close();
    }
}

if ("WorkerGlobalScope" in self) {
    addEventListener("message", handleAuthMessage);
}
