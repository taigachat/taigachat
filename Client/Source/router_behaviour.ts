import type { Immutable } from "./immutable";
import { UNLOADED_CLIENT_USERS } from "./store";
import type { MainStore } from "./store";
import { setRouterBehaviour } from "./routes";

function isNotEmpty(obj: Record<string, unknown>) {
    // TODO: this function is sad! remove it somehow.
    for (const v in obj) {
        if (obj[v] !== undefined) {
            return true;
        }
    }
    return false;
}

export function handleStoreChanged(s: Immutable<MainStore>) {
    setRouterBehaviour(s.clientUsers === UNLOADED_CLIENT_USERS, isNotEmpty(s.clientUsers));
}
