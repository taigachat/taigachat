import { registerDebugCommand } from "./debug_mode";
import { hasLauncher, launcherPortSecret } from "./options";

export { hasLauncher };

// TODO: there is a problem with running the launcher from WSL2 since the enviromnent variable isn't being properly sent

// TODO: Currently an evil URL could trick us to connect localhost:ANYPORT by setting ?launcher=ANYPORT. We should probably authenticate a bit more.

function getLauncherURL(text: string) {
    const [port, secret, _version] = launcherPortSecret.split("-");
    const url = `http://localhost:${port}/launcher0/${secret}/${text}`;
    return url;
}

export function launcherSSE(text: string) {
    const sse = new EventSource(getLauncherURL(text));
    return sse;
}

export async function sendLauncherCommand(text: string, body?: string) {
    if (!hasLauncher) {
        // TODO: Perhaps the formatting could be made into its own variable.
        console.trace("%c launcher command sent despite lack of launcher", "background-color: yellow;");
        return;
    }
    const url = getLauncherURL(text);
    const req = await fetch(url, { method: "POST", body });
    return await req.text();
}

registerDebugCommand("sendLauncherCommand", sendLauncherCommand);
