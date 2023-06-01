import { platform } from './options'
import { sendLauncherCommand } from './launcher_bridge'
export function openURL(url: string) {
    if (platform === 'web') {
        window.open(url)?.focus() 
    } else {
        sendLauncherCommand(`open-url ${url}`)
    }
}
