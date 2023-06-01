import { webcrypto } from 'crypto'
const crypto = { subtle: (webcrypto as any).subtle as SubtleCrypto }
import { readFileSync, existsSync, writeFileSync, statSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { spawnSync, } from 'child_process'

function runOnce(desc: string, f: () => Promise<void>|void) {
    let hasRun = false
    return async () => {
        if (!hasRun) {
            hasRun = true
            let time = new Date()
            // TODO: Zero pad
            console.log(`[${time.getHours()}:${time.getMinutes()}] now ${desc}`)
            try {
                await f()
            } catch (e) {
                console.log(`[error] an exception was thrown while ${desc}`)
                throw e
            }
        }
    }
}

async function createKey() {
    const { privateKey } = await crypto.subtle.generateKey(
        {
            name: 'RSA-PSS',
            modulusLength: 4096,
            publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
            hash: { name: 'SHA-512' },
        },
        true,
        ['sign', 'verify']
    )
    return crypto.subtle.exportKey('jwk', privateKey)
}


const percivalBuffer = new Uint8Array([0x70, 0x65, 0x72, 0x63, 0x69, 0x76, 0x61, 0x6C])

async function doubleHashFile(filename: string) {
    const bytes = readFileSync(filename, null)
    const hash = await crypto.subtle.digest(
        "SHA-512",
        new Uint8Array(bytes.buffer)
    )
    const arrayBuffer = new Uint8Array(hash) 
    let doubleHash = new Uint8Array(arrayBuffer.length * 2 + percivalBuffer.length)
    doubleHash.set(arrayBuffer, 0)
    doubleHash.set(percivalBuffer, arrayBuffer.length)
    doubleHash.set(arrayBuffer, arrayBuffer.length + percivalBuffer.length)
    return doubleHash
}

async function sign(keys: any[], doubleHash: Uint8Array) {
    //console.error('FIRST double hash is', Buffer.from(doubleHashP.buffer).toString('base64url'))
    //console.error('SECOND double hash is', Buffer.from(globalB.buffer).toString('base64url'))
    //console.error('THIRD double hash is', globalB.toString('base64url'))
    //console.log('digest:', Buffer.from(await crypto.subtle.digest('SHA-512', bytes)).toString('base64url'))
    const output: string[] = []
    for(const key of keys) {
        const importedKey = await crypto.subtle.importKey(
            'jwk',
            key,
            {
                name: 'RSA-PSS',
                hash: 'SHA-512',
            },
            false,
            ['sign']
        )

        //console.log('hash for', filename, 'is', double_hash.toString('base64url'))
        //console.error('double hash type', doubleHashP.constructor.name)
        //console.error('double hash is', Buffer.from(doubleHashP.buffer).toString('base64url'))

        const signature = await crypto.subtle.sign(
            {
                name: 'RSA-PSS',
                saltLength: 32,
            },
            importedKey,
            doubleHash,
        )
        output.push(Buffer.from(signature).toString('base64url'))
    }
    return output
}


function fileSize(path: string) {
    return statSync(path).size
}

function bufferToHex(b: ArrayBuffer) {
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}

async function productIdFromVersion(version: string) {
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-512', enc.encode('glowie taigachat ' + version))
    const hex = bufferToHex(digest)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16,20)}-${hex.slice(20, 32)}`
}

async function main() {
    const projectRoot = process.env['TAIGACHAT_PROJECT_ROOT'] || dirname(__dirname)
    const { version, name } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), {encoding: 'utf8'}))
    const signingKeysPath = join(projectRoot, 'signing_keys.json')
    const baseDownloadURL = process.env['BASE_URL'] || 'https://cdn.taigachat.se/versions/'
    const uploadURL = process.env['UPLOAD_URL'] || ''
    const distPath = join(projectRoot, 'dist')
    const buildPath = join(projectRoot, 'build/')
    const geniconsPath = join(projectRoot, 'genicons')
    const wixPath = process.env['WIX'] || ''
    const inkscapePathFallback = process.platform === 'win32' ? '' : 'inkscape'
    const inkscapePath = process.env['INKSCAPE'] || inkscapePathFallback

    let keys: any[] = []
    if (existsSync(signingKeysPath)) {
        // TODO: Password protect the signing keys file
        keys = JSON.parse(readFileSync(signingKeysPath, { encoding: 'utf8' }))
    }

    function cmd(cmd: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string) {
        if (process.platform == 'win32' && cmd.indexOf(' ') !== -1) {
            cmd = join('"' + dirname(cmd) + '"', basename(cmd))
        }
        let run = spawnSync(cmd, args, {
            stdio: 'inherit',
            shell: true,
            cwd: cwd || projectRoot,
            env,
        }) 
        if (run.status !== 0) {
            throw `${cmd} exited with non zero, aborting`
        }
    }

    const anyKey = async () => {
        console.log('PRESS ANY KEY TO CONTINUE')
        process.stdin.setRawMode(true)
        return new Promise<void>(resolve => process.stdin.once('data', () => {
            process.stdin.setRawMode(false)
            resolve()
        }))
    }


    function tarGzName(platform: string) {
        return `${name}-x64-${platform.replace('win32','win')}-${version}.tar.gz`
    }

    const taskBuildIcons = runOnce('creating icon files', async () => {
        if (inkscapePath === '') {
            // TODO: What happens with build process if build is made without inkscape or ffmpeg?
            console.log('WARNING: INKSCAPE variable not set, skipping icon generation')
        } else {
            mkdirSync(geniconsPath, {recursive: true})
            mkdirSync(join(geniconsPath, 'static'), {recursive: true})
            /*cmd('ffmpeg', ['-y', '-i', join(projectRoot, 'static', 'logo.png'), '-vf', 'scale=256:256', join(geniconsPath, 'icon-256.png')])
            cmd('ffmpeg', ['-y', '-i', join(projectRoot, 'static', 'logo.png'), '-vf', 'scale=32:32', join(geniconsPath, 'icon-32.png')])
            cmd('ffmpeg', ['-y', '-i', join(projectRoot, 'static', 'logo.png'), '-vf', 'scale=512:512', join(geniconsPath, 'icon.png')])
            cmd('ffmpeg', ['-y', '-i', join(projectRoot, 'static', 'logo.png'), '-vf', 'scale=512:512', join(geniconsPath, 'icon.png')])
            cmd('ffmpeg', ['-y', '-i', join(projectRoot, 'static', 'logo.png'), '-vf', 'scale=1200:1200', join(geniconsPath, 'favicon.png')])
            cmd('ffmpeg', ['-y', '-i', join(projectRoot, 'static', 'logo.png'), '-vf', 'scale=144:144', join(geniconsPath, 'static', 'icon-144.png')])
            */


            function svgToPNG(logoInput: string, logoOutput: string, width: number, height: number) {
                // Beware of using this type of SVG conversion for really small images.

                // (plug-in-autocrop RUN-NONINTERACTIVE image drawable)
                cmd('gimp', ['-i', '-b',
                             `"(let* ((image (car (file-svg-load RUN-NONINTERACTIVE
                                                                 \\"${logoInput}\\"
                                                                 \\"\\"
                                                                 72
                                                                 (- 0 ${width})
                                                                 (- 0 ${height})
                                                                 0)))
                                      (drawable (car (gimp-image-get-active-layer image))))
                                     (gimp-file-save RUN-NONINTERACTIVE image drawable \\"${logoOutput}\\" \\"${logoOutput}\\")
                                     (gimp-image-delete image))"`,
                            '-b', '"(gimp-quit 0)"'])
            }

            const icon48 = join(geniconsPath, 'icon-48.png')
            svgToPNG(join(projectRoot, 'top', 'logo.svg'), icon48, 48, 48)

            const icon256 = join(geniconsPath, 'icon-256.png')
            svgToPNG(join(projectRoot, 'top', 'logo.svg'), icon256, 256, 256)

            const icon512 = join(geniconsPath, 'icon-512.png')
            svgToPNG(join(projectRoot, 'top', 'logo.svg'), icon512, 512, 512)

            const icon1200 = join(geniconsPath, 'favicon.png')
            svgToPNG(join(projectRoot, 'top', 'logo.svg'), icon1200, 1200, 1200)

            const icon144 = join(geniconsPath, 'static', 'icon-144.png')
            svgToPNG(join(projectRoot, 'top', 'logo.svg'), icon144, 144, 144)

            const icoFile = join(geniconsPath, 'icon.ico')

            const icon32 = join(projectRoot, 'top', 'icon-32.png')
            cmd('convert', [icon32, icon48, icon144, icon256, '-compress', 'zip', icoFile])
            /*
            svgToPNG(join(projectRoot, 'static', 'logo.svg'), join(geniconsPath, 'icon-32.png'), 32, 32)
            cmd(inkscapePath, [join(projectRoot, 'static', 'logo.svg'), '--export-width=256', '--export-filename=' + join(geniconsPath, 'icon-256.png')])
            cmd(inkscapePath, [join(projectRoot, 'static', 'logo.svg'), '--export-width=32',  '--export-filename=' + join(geniconsPath, 'icon-32.png')])
            cmd(inkscapePath, [join(projectRoot, 'static', 'logo.svg'), '--export-width=512', '--export-filename=' + join(geniconsPath, 'icon.png')])
            cmd(inkscapePath, [join(projectRoot, 'static', 'logo.svg'), '--export-width=1200', '--export-filename=' + join(geniconsPath, 'favicon.png')])
            cmd(inkscapePath, [join(projectRoot, 'static', 'logo.svg'), '--export-width=144', '--export-filename=' + join(geniconsPath, 'static', 'icon-144.png')])
            */
            //cmd('ffmpeg', ['-y', '-i', join(geniconsPath, 'static', 'icon-144.png'), '-i', join(geniconsPath, 'icon-256.png'), '-pix_fmt bgra', join(geniconsPath, 'icon.ico')])
        }
    })

    const taskBuildJS = runOnce('building js', async () => {
        await taskBuildIcons()
        cmd('yarn', ['snowpack', 'build', '--polyfill-node'], {
            'SNOWPACK_PUBLIC_VERSION': version,
            'SNOWPACK_PUBLIC_UPDATE_URL': baseDownloadURL,
            'SNOWPACK_PUBLIC_CENTRAL_URL': '',
            'SNOWPACK_PUBLIC_CSP': '',
        })
    })

    const taskBuildWin32 = runOnce('building win32 app', async () => {
        await taskBuildIcons()
        await taskBuildJS()
        cmd('yarn', ['electron-builder', '--windows=tar.gz'])
    })

    const taskBuildLinux = runOnce('building linux app', async () => {
        await taskBuildJS()
        cmd('yarn', ['electron-builder', '--linux=tar.gz'])
    })

    async function createMsi() {
        if (wixPath === '') {
            throw 'please provide a valid WIX variable'
        }
        const productID = await productIdFromVersion(version)
        console.log('productID:', productID)
        cmd(join(wixPath, 'bin', 'candle.exe'), [`-dProductName="${name}"`, `-dProdId="${productID}"`, `-dVersion="${version}"`, '-out', `"${join(distPath, 'Client.wixobj')}"`, join(projectRoot, 'scripts', 'Client.wxs')])
        cmd(join(wixPath, 'bin', 'light.exe'), ['-out', `"${join(distPath, name + '.msi')}"`, '-ext', 'WixUIExtension', join(distPath, 'Client.wixobj')])
    }

    const taskBuildLauncherWin32 = runOnce('building launcher', async () => {
        const time = new Date()
        cmd('cargo', ['build', '--release'], {
            ...process.env,
            APP_BUILDDATE: `${time.getUTCFullYear()}-${time.getUTCMonth()}-${time.getUTCDate()} ${time.getUTCHours()}:${time.getUTCMinutes()}`,
            APP_BUNDLED_TAR_GZ: tarGzName('win32'),
        }, join(projectRoot, 'app-launcher'))
    })

    async function releaseManifest(platform: string) {
        let file = tarGzName(platform)
        const filepath = join(distPath, file)
        const doubleHash = await doubleHashFile(filepath)
        let signatures = await sign(keys, doubleHash)
        let output = JSON.stringify({
            version,
            url: baseDownloadURL + encodeURIComponent(file),
            signatures,
            doubleHash: Buffer.from(doubleHash).toString('base64url'),
            size: fileSize(filepath)
        }, undefined, 4)
        await writeFile(join(distPath, `${platform}.json`), output)
        return filepath
    }

    const commands: Record<string, ((args: string[]) => Promise<string|void>|string)> = {
        'new-key': async () => {
            keys.push(await createKey())
            writeFileSync(signingKeysPath, JSON.stringify(keys, undefined, 4), { encoding: 'utf8' })
        },
        'sign-file': async ([filename]) => {
            return JSON.stringify(await sign(keys, await doubleHashFile(filename)), undefined, 4) 
        },
        'export-key': () => {
            const lastKey = keys[keys.length - 1]
            if (lastKey === undefined) {
                throw 'no keys yet'
            }
            return JSON.stringify({
                key_ops: ['verify'],
                ext: lastKey.ext,
                kty: lastKey.kty,
                n: lastKey.n,
                e: lastKey.e,
                alg: lastKey.alg,
            }, undefined, 4)
        },
        'release-manifest': async ([platform]) => {
            return await releaseManifest(platform)
        },
        'deploy': async (platforms) => {
            const filesToSend: string[] = []
            for (const platform of platforms) {
                switch(platform) {
                    case 'dirty-msi':
                        await createMsi()
                        break
                    case 'icons':
                        await taskBuildIcons()
                        break
                    case 'web':
                        await taskBuildJS()
                        filesToSend.push(buildPath)
                        break
                    case 'msi':
                        await taskBuildLauncherWin32()
                        await taskBuildWin32()
                        await createMsi()
                        filesToSend.push(join(distPath, name + '.msi'))
                        break
                    case 'win32':
                        await taskBuildWin32()
                        filesToSend.push(await releaseManifest(platform))
                        filesToSend.push(join(distPath, `${platform}.json`))
                        break
                    case 'linux':
                        await taskBuildLinux()
                        filesToSend.push(await releaseManifest(platform))
                        filesToSend.push(join(distPath, `${platform}.json`))
                        break
                    default:
                        throw 'unsupported platform: ' + platform
                }
            }
            console.log('sending', filesToSend)
            if (uploadURL != '') {
                await anyKey()
                if (process.platform !== 'win32') {
                    cmd('sync', [])
                }
                cmd('sleep', ['1'])
                cmd('scp', ['-r', ...filesToSend, uploadURL])
                return 'done'
            } else {
                return 'no UPLOAD_URL environment variable provided, skipping upload'
            }
        },
        'web-dev': () => {
            cmd('yarn', ['snowpack', 'dev'], {
                SNOWPACK_PUBLIC_CENTRAL_URL: 'http://localhost:8014',
                SNOWPACK_PUBLIC_UPDATE_URL: baseDownloadURL,
                SNOWPACK_PUBLIC_VERSION: 'developer',
                SNOWPACK_PUBLIC_CSP: `; script-src 'unsafe-inline' 'self'`,
            })
            return ''
        },
        'info': () => {
            return `package version: ${version}\nbase download url: ${baseDownloadURL}\nupload url: ${uploadURL}\nproject root: ${projectRoot}\nkeys: ${keys.length}\ninkscape: ${inkscapePath}` 
        }
    }

    let commandName = process.argv[2]
    if (commandName in commands) {
        try {
            let result = await commands[commandName](process.argv.slice(3))
            if (typeof result === 'number') { 
                process.exit(result)
            } else {
                console.log(result)
                process.exit(0)
            }
        } catch(e) {
            console.log(e)
        }
    } else {
        let text = commandName === 'help' ? 'list of possible commands:' : `unsupported command: ${commandName}, try:`
        console.log(`${text} ${Object.keys(commands).join(', ')}`) 
    }
}

main()
