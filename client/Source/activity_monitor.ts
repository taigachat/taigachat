import { sendLauncherCommand } from "./launcher_bridge";
import { updateLastActivityCheck } from "./store";
import type { ListedServer, MainStore } from "./store";
import type { Immutable } from "./immutable";
import { onServer } from "./actions";

let listedServer: Immutable<Record<string, ListedServer>> = {};

function sendUserActiveHeartbeat() {
    for (const serverID in listedServer) {
        // TODO: Add some random time here between each server so that servers can't track users.
        onServer.userIsActive0(serverID);
    }
}

export function startUserIsActiveInterval() {
    // TODO: Make a worse version work for web as well.
    setInterval(
        async () => {
            updateLastActivityCheck();
            const state = await sendLauncherCommand("isActive0");
            if (state == "userIsActive") {
                sendUserActiveHeartbeat();
            }
        },
        5 * 60 * 1000
    );
    //}, 2 * 1000)
    // TODO: The interval should be configurable.
}

export function handleStoreChanged(s: Immutable<MainStore>) {
    listedServer = s.listedServers;
}
