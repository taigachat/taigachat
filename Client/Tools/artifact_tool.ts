// TODO: Remove entire file in favour of vite config and new task system.

import { webcrypto } from "crypto";
const crypto = { subtle: (webcrypto as any).subtle as SubtleCrypto };
import { readFileSync, existsSync, writeFileSync, statSync } from "fs";
import { writeFile } from "fs/promises";
import { join, dirname, basename } from "path";
import { spawnSync } from "child_process";

const projectRoot = process.env["TAIGACHAT_PROJECT_ROOT"] || dirname((import.meta as any).dirname);
const signingKeysPath = join(projectRoot, "signing_keys.json");
const baseDownloadURL = process.env["ARTIFACT_AUTO_UPDATE_URL"] || "https://cdn.taigachat.se/versions/";
const uploadURL = process.env["UPLOAD_URL"] || "";
const artifactOutputPath = join(projectRoot, "Build", "Packaged");
const viteOutputPath = join(projectRoot, "Build", "Web");
const wixPath = process.env["WIX"] || "";

function zeroPad(p: string) {
    return p.length < 2 ? "0" + p : p;
}

function runOnce(desc: string, f: () => Promise<void> | void) {
    let hasRun = false;
    return async () => {
        if (!hasRun) {
            hasRun = true;
            const time = new Date();
            console.log(`[${zeroPad(`${time.getHours()}`)}:${zeroPad(`${time.getMinutes()}`)}] now ${desc}`);
            try {
                await f();
            } catch (e) {
                console.log(`[error] an exception was thrown while ${desc}`);
                throw e;
            }
        }
    };
}

async function createKey() {
    const { privateKey } = await crypto.subtle.generateKey(
        {
            name: "RSA-PSS",
            modulusLength: 4096,
            publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
            hash: { name: "SHA-512" },
        },
        true,
        ["sign", "verify"]
    );
    return crypto.subtle.exportKey("jwk", privateKey);
}

const percivalBuffer = new Uint8Array([0x70, 0x65, 0x72, 0x63, 0x69, 0x76, 0x61, 0x6c]);

async function doubleHashFile(filename: string) {
    const bytes = readFileSync(filename, null);
    const hash = await crypto.subtle.digest("SHA-512", new Uint8Array(bytes.buffer));
    const arrayBuffer = new Uint8Array(hash);
    const doubleHash = new Uint8Array(arrayBuffer.length * 2 + percivalBuffer.length);
    doubleHash.set(arrayBuffer, 0);
    doubleHash.set(percivalBuffer, arrayBuffer.length);
    doubleHash.set(arrayBuffer, arrayBuffer.length + percivalBuffer.length);
    return doubleHash;
}

async function sign(keys: any[], doubleHash: Uint8Array) {
    // TODO: Actually implement some standard here instead.

    const output: string[] = [];
    for (const key of keys) {
        const importedKey = await crypto.subtle.importKey(
            "jwk",
            key,
            {
                name: "RSA-PSS",
                hash: "SHA-512",
            },
            false,
            ["sign"]
        );

        const signature = await crypto.subtle.sign(
            {
                name: "RSA-PSS",
                saltLength: 32,
            },
            importedKey,
            doubleHash
        );
        output.push(Buffer.from(signature).toString("base64url"));
    }
    return output;
}

function fileSize(path: string) {
    return statSync(path).size;
}

function bufferToHex(b: ArrayBuffer) {
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function productIdFromVersion(version: string) {
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-512", enc.encode("glowie taigachat " + version));
    const hex = bufferToHex(digest);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function cmd(cmd: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string) {
    if (process.platform == "win32" && cmd.indexOf(" ") !== -1) {
        cmd = join('"' + dirname(cmd) + '"', basename(cmd));
    }
    const run = spawnSync(cmd, args, {
        stdio: "inherit",
        shell: true,
        cwd: cwd || projectRoot,
        env,
    });
    if (run.status !== 0) {
        throw `${cmd} exited with non zero, aborting`;
    }
}

async function main() {
    const { version, name } = JSON.parse(
        readFileSync(join(projectRoot, "package.json"), { encoding: "utf8" })
    );

    const filesToSend: string[] = [];

    let keys: any[] = [];
    if (existsSync(signingKeysPath)) {
        // TODO: Password protect the signing keys file
        keys = JSON.parse(readFileSync(signingKeysPath, { encoding: "utf8" }));
    }

    const anyKey = async () => {
        console.log("PRESS ANY KEY TO CONTINUE");
        process.stdin.setRawMode(true);
        return new Promise<void>((resolve) =>
            process.stdin.once("data", () => {
                process.stdin.setRawMode(false);
                resolve();
            })
        );
    };

    function tarGzName(platform: string) {
        return `${name}-x64-${platform.replace("win32", "win")}-${version}.tar.gz`;
    }

    const taskBuildJS = runOnce("building js", async () => {
        cmd("pnpm", ["vite", "build"], {});
    });

    const taskBuildWin32 = runOnce("building win32 app", async () => {
        await taskBuildJS();
        cmd("pnpm", ["electron-builder", "--windows=tar.gz"]);

        await releaseManifestAndTarGz("win32");
        console.log("filesToSend:", filesToSend);
    });

    const taskBuildLinux = runOnce("building linux app", async () => {
        await taskBuildJS();
        cmd("pnpm", ["electron-builder", "--linux=tar.gz"]);
    });

    async function createMsi() {
        if (wixPath === "") {
            throw "please provide a valid WIX variable";
        }
        const productID = await productIdFromVersion(version);
        console.log("productID:", productID);
        cmd(join(wixPath, "bin", "candle.exe"), [
            `-dProductName="${name}"`,
            `-dProdId="${productID}"`,
            `-dVersion="${version}"`,
            "-out",
            `"${join(artifactOutputPath, "Client.wixobj")}"`,
            join(projectRoot, "Tools", "Client.wxs"),
        ]);
        cmd(join(wixPath, "bin", "light.exe"), [
            "-out",
            `"${join(artifactOutputPath, name + ".msi")}"`,
            "-ext",
            "WixUIExtension",
            join(artifactOutputPath, "Client.wixobj"),
        ]);
    }

    const taskBuildLauncherWin32 = runOnce("building launcher", async () => {
        const time = new Date();
        cmd(
            "cargo",
            ["build", "--release"],
            {
                ...process.env,
                APP_BUILDDATE: `${time.getUTCFullYear()}-${time.getUTCMonth()}-${time.getUTCDate()} ${time.getUTCHours()}:${time.getUTCMinutes()}`,
                APP_BUNDLED_TAR_GZ: tarGzName("win32"),
            },
            join(projectRoot, "AppLauncher")
        );
    });

    async function releaseManifestAndTarGz(platform: string) {
        const file = tarGzName(platform);
        const filepath = join(artifactOutputPath, file);
        const doubleHash = await doubleHashFile(filepath);
        const signatures = await sign(keys, doubleHash);
        const output = JSON.stringify(
            {
                version,
                url: baseDownloadURL + encodeURIComponent(file),
                signatures,
                doubleHash: Buffer.from(doubleHash).toString("base64url"),
                size: fileSize(filepath),
            },
            undefined,
            4
        );
        await writeFile(join(artifactOutputPath, `${platform}.json`), output);

        filesToSend.push(join(artifactOutputPath, `${platform}.json`));
        filesToSend.push(filepath);
    }

    const commands: Record<string, (args: string[]) => Promise<string | void> | string> = {
        "new-key": async () => {
            keys.push(await createKey());
            writeFileSync(signingKeysPath, JSON.stringify(keys, undefined, 4), { encoding: "utf8" });
        },
        "sign-file": async ([filename]) => {
            return JSON.stringify(await sign(keys, await doubleHashFile(filename || "")), undefined, 4);
        },
        "export-key": () => {
            const lastKey = keys[keys.length - 1];
            if (lastKey === undefined) {
                throw "no keys yet";
            }
            return JSON.stringify(
                {
                    key_ops: ["verify"],
                    ext: lastKey.ext,
                    kty: lastKey.kty,
                    n: lastKey.n,
                    e: lastKey.e,
                    alg: lastKey.alg,
                },
                undefined,
                4
            );
        },
        "release-manifest": async ([platform]) => {
            return await releaseManifestAndTarGz(platform || "");
        },
        deploy: async (platforms) => {
            for (const platform of platforms) {
                switch (platform) {
                    case "dirty-msi":
                        await createMsi();
                        break;
                    case "web":
                        await taskBuildJS();
                        filesToSend.push(viteOutputPath);
                        break;
                    case "msi":
                        await taskBuildLauncherWin32();
                        await taskBuildWin32();
                        await createMsi();
                        filesToSend.push(join(artifactOutputPath, name + ".msi"));
                        break;
                    case "win32":
                        await taskBuildWin32();
                        break;
                    case "linux":
                        await taskBuildLinux();
                        await releaseManifestAndTarGz(platform);
                        break;
                    default:
                        throw "unsupported platform: " + platform;
                }
            }
            console.log("sending", filesToSend);
            if (uploadURL != "") {
                await anyKey();
                if (process.platform !== "win32") {
                    cmd("sync", []);
                }
                cmd("sleep", ["1"]);

                cmd(process.platform === "win32" ? "pscp" : "scp", ["-r", ...filesToSend, uploadURL]);
                return "done";
            } else {
                return "no UPLOAD_URL environment variable provided, skipping upload";
            }
        },
        info: () => {
            return `package version: ${version}\nbase download url: ${baseDownloadURL}\nupload url: ${uploadURL}\nproject root: ${projectRoot}\nkeys: ${keys.length}\n`;
        },
    };

    const commandName = process.argv[2];
    if (commandName && commandName in commands) {
        try {
            const command = commands[commandName];
            if (command) {
                const result = await command(process.argv.slice(3));
                if (typeof result === "number") {
                    process.exit(result);
                } else {
                    console.log(result);
                    process.exit(0);
                }
            }
        } catch (e) {
            console.log(e);
        }
    } else {
        const text =
            commandName === "help"
                ? "list of possible commands:"
                : `unsupported command: ${commandName}, try:`;
        console.log(`${text} ${Object.keys(commands).join(", ")}`);
    }
}

main();
