// @ts-check

import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { runTask, makeFile, theFile, GeneratorError } from "./task.mjs";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

import packageJson from "./package.json";

const packageVersion = packageJson.version;

const gimpPath = process.env["GIMP"] || "gimp"; // We want the gimp-console-*.exe on windows

const publicPath = "./Public";

// Make sure the output folder exists.
const topOutPath = join(publicPath, "out");
if (!existsSync(topOutPath)) {
    mkdirSync(topOutPath);
}

/**
 * @param {string} path
 */
function forceUnixPath(path) {
    // One can really question why we are first using the platform-specific join() followed by a call
    // to this function... But here we are.
    return process.platform == "win32" ? path.replace(/\\/g, "/") : path;
}

/**
 * @param {string} logoOutput
 * @param {string[]} logoInput
 * @param {{width: number, height: number}} width, height
 */
function svgToPNG(logoOutput, [logoInput], { width, height }) {
    console.log("info: generating icon ", logoOutput);
    // Beware of using this type of SVG conversion for really small images.
    // TODO: (plug-in-autocrop RUN-NONINTERACTIVE image drawable)
    const batch = `(let*
                       (
                           (image (car (file-svg-load RUN-NONINTERACTIVE
                                                      "${forceUnixPath(logoInput)}"
                                                      ""
                                                      72
                                                      (- 0 ${width})
                                                      (- 0 ${height})
                                                      0)))
                           (drawable (car (gimp-image-get-active-layer image)))
                       )
                       (gimp-file-save RUN-NONINTERACTIVE image drawable "${forceUnixPath(logoOutput)}" "${forceUnixPath(logoOutput)}")
                       (gimp-image-delete image)
                   )`;
    let run = spawnSync(gimpPath, ["-i", "-b", batch, "-b", "(gimp-quit 0)"], {
        stdio: "inherit",
        shell: false,
    });
    if (run.status !== 0) {
        throw new GeneratorError(`${gimpPath} exited with a non-zero code`);
    }
}

/**
 * @param {string} icoOutput
 * @param {string[]} icon256, icon144, icon48, icon32
 */
function createICO(icoOutput, [icon256, icon144, icon48, icon32]) {
    const batch = `
        (let*
            (
                (final-image (car (gimp-image-new 64 64 RGB)))
                (add-part (lambda (path) (let*
                    (
                        (img (car (file-png-load RUN-NONINTERACTIVE path path)))
                        (loaded-layer (car (gimp-image-get-active-layer img)))
                        (layer (car (gimp-layer-new-from-drawable loaded-layer final-image)))
                    )
                    (gimp-layer-set-name layer "Massah")
                    (gimp-image-insert-layer final-image layer 0 -1)
                )))
            )
            (add-part "${forceUnixPath(icon256)}")
            (add-part "${forceUnixPath(icon144)}")
            (add-part "${forceUnixPath(icon48)}")
            (add-part "${forceUnixPath(icon32)}")
            (file-ico-save RUN-NONINTERACTIVE final-image (car (gimp-image-get-active-drawable final-image)) "${forceUnixPath(icoOutput)}" "${forceUnixPath(icoOutput)}")
        )
    `;
    let run = spawnSync(gimpPath, ["-i", "-b", batch, "-b", "(gimp-quit 0)"], {
        stdio: "inherit",
        shell: false,
    });
    if (run.status !== 0) {
        throw `${gimpPath} exited with non zero, aborting`;
    }
}

/**
 * @param {number} size
 */
function iconTask(size) {
    return makeFile(join(topOutPath, `icon-${size}.png`), [theFile(join("Public", "logo.svg"))], svgToPNG, {
        width: size,
        height: size,
    });
}

const icon32 = theFile(join("Public", "icon-32.png"));
const icon48 = iconTask(48);
const icon144 = iconTask(144);
const icon256 = iconTask(256);
const icon512 = iconTask(512);
const icon1200 = iconTask(1200);

const iconICO = makeFile(join(topOutPath, "icon.ico"), [icon256, icon144, icon48, icon32], createICO);

runTask(iconICO);
runTask(icon512);
runTask(icon1200);

const cacheBlacklist = ["robots.txt", "manifest.json", "service-worker.js", "electron.css"];

/**
 * @param {string} dir
 * @param {string[]} into
 * @param {string} prefix
 */
function findImportantFilesToCache(dir, into, prefix) {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
        if (file.isDirectory()) {
            findImportantFilesToCache(join(dir, file.name), into, prefix + "/" + file.name);
        } else if (cacheBlacklist.indexOf(file.name) === -1) {
            into.push(prefix + "/" + file.name);
        }
    }
}

/**
 * @returns {import("vite").Plugin}
 */
function serviceWorkerGenerator() {
    return {
        name: "service-worker-generator",
        enforce: "post",
        apply: "build",
        generateBundle(_options, bundle, _isWrite) {
            const swPath = join(publicPath, "service-worker.js");

            const swSource = readFileSync(swPath, "utf8");

            const cachedFiles = [];

            findImportantFilesToCache(publicPath, cachedFiles, ".");

            for (const chunk of Object.values(bundle)) {
                cachedFiles.push("./" + chunk.fileName);
            }

            const newSW = swSource
                .replace(`appVersion = "0.0.0"`, `appVersion = "${packageVersion}"`)
                .replace(`cachedFiles = []`, `cachedFiles = ${JSON.stringify(cachedFiles)}`);

            this.emitFile({
                type: "asset",
                fileName: "service-worker.js",
                source: newSW,
            });
        },
    };
}

/**
 * @returns {import("vite").Plugin}
 */
function editionGenerator() {
    return {
        name: "edition-generator",

        /**
         * @param {string} source
         * @param {string} id
         */
        transform(source, id) {
            if (!id.endsWith("/edition.js")) {
                return;
            }

            // TODO: We can add more configurations here later. For now, this is enough.
            source = source
                .replace(`appVersion = "0.0.0"`, `appVersion = "${packageVersion}"`)
                .replace(`clientName = "TaigaChat"`, `clientName = "${packageJson.name}"`)
                .replace(`isDeveloper = false`, `isDeveloper = ${this.meta.watchMode}`);

            return source;
        },
    };
}

// https://vite.dev/config/
export default defineConfig({
    base: "",
    build: {
        outDir: "./Build/Web",
        rollupOptions: {
            output: {
                manualChunks: {
                    mediasoup: ["mediasoup-client"],
                },
            },
        },
    },
    plugins: [svelte(), editionGenerator(), serviceWorkerGenerator()],
    publicDir: publicPath,
});
