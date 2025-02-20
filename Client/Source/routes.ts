// The purpose of this file is to understand the hash sign part of the local URL.
// As well as extract the open popup from the browser navigation state.

import { z } from "zod";

import { devicePermissions } from "./device_permissions";
import { registerDebugCommand } from "./debug_mode";

let sessionHasUser = false;
let sessionIsLoading = true;

// TODO: More fitting name is NO_POPUP
export const EMPTY_POPUP = {};

const popupType = z.union([
    z.object({
        addServer: z.literal(true),
    }),
    z.object({
        showChangelog: z.literal(true),
    }),
    z.object({
        emojiPicker: z.object({
            serverID: z.string(),
            roomID: z.number(),
        }),
    }),
    z.object({
        authenticator: z.string(),
    }),
    z.object({
        connectWithCentral: z.string(),
    }),
    z.object({
        viewImage: z.string(),
    }),
    z.object({
        inviter: z.string(),
    }),
    z.object({
        confirmDeleteMessage: z.object({
            serverID: z.string(),
            roomID: z.number(),
            chunkID: z.number(),
            messageIndex: z.number(),
        }),
    }),
    z.object({
        viewUser: z.object({
            userID: z.string(),
            serverID: z.string(),
        }),
    }),
    z.object({
        requestPermission: devicePermissions,
    }),
    z.object({
        addEndToEndKey: z.object({
            serverID: z.string(),
            expectedFingerprint: z.string(),
        }),
    }),
    // No popup.
    z.object({}),
]);
export type Popup = z.infer<typeof popupType>;

export type Page =
    | {
          name: "login";
          forced: boolean;
      }
    | {
          name: "offline-login";
      }
    | {
          name: "page-not-found";
      }
    | {
          name: "settings";
          category: string;
          serverID: string;
      }
    | {
          name: "loading";
      }
    | {
          name: "main";
          serverID: string;
          roomID: number;
      }
    | {
          name: "view-server";
          serverID: string;
      }
    | {
          name: "mobile-overview";
          serverID: string;
          roomID: number;
      };

export interface NavigationStatus {
    popup: Popup;
    page: Page;
    hash: string;
    popupCount: number;
    previousPage: number;
}

let navigationStatus: NavigationStatus = {
    popup: EMPTY_POPUP,
    page: { name: "loading" },
    hash: "",
    popupCount: 0,
    previousPage: 0,
};

let navigationStatusCallbacks: ((value: NavigationStatus) => void)[] = [];
export const navigationStatusStore = {
    // TODO: Perhaps we should only support one listener in the future.
    // How would netcode get this data?
    subscribe(func: (value: NavigationStatus) => void) {
        navigationStatusCallbacks.push(func);
        func(navigationStatus);
        return function () {
            navigationStatusCallbacks = navigationStatusCallbacks.filter((cb) => cb != func);
        };
    },
};

function parsePageLocation(str: string, sessionIsLoading: boolean, sessionHasUser: boolean): Page {
    const noBang = str.substring(1);

    if (sessionIsLoading) {
        return {
            name: "loading",
        };
    }

    // We default to #main if no bang is provided.
    const p = new URLSearchParams(noBang === "" ? "main" : noBang);

    for (const [name, value] of p) {
        if (name === "login") {
            return { name, forced: false };
        }
        if (name === "offline-login") {
            return { name };
        }
        if (name === "settings") {
            const serverID = p.get("serverID") || "";
            return {
                name,
                category: value,
                serverID,
            };
        }
        if (name === "main") {
            const serverID = value || "";
            const roomID = parseInt(p.get("roomID") || "-1");

            return sessionHasUser
                ? {
                      name,
                      serverID,
                      roomID,
                  }
                : {
                      name: "login",
                      forced: true,
                  };
        }
        if (name === "view-server") {
            return {
                name,
                serverID: value || "",
            };
        }
        if (name === "mobile-overview") {
            const roomID = parseInt(p.get("roomID") || "-1");
            return {
                name,
                serverID: value || "",
                roomID,
            };
        }
    }
    return { name: "page-not-found" };
}

let handledHash = "";
function updateNavigationStatus(state: NavigationStatus | Record<string, unknown>) {
    // This function is first called by:
    // dispatch() -> router_behaviour -> setRouterBehaviour()

    let hash = window.location.hash;
    //console.error('handle:', state)
    let previousPage = 0;
    let popupCount = 0;

    let popup: Popup = EMPTY_POPUP;
    try {
        if (state && typeof state.hash === "string") {
            hash = state.hash;
        }
        if (state && state.popup) {
            popup = popupType.parse(state.popup);
        }
        if (state && typeof state.previousPage === "number") {
            previousPage = state.previousPage;
        }
        if (state && typeof state.popupCount === "number") {
            popupCount = state.popupCount;
        }
    } catch (e) {
        console.error(e);
    }
    const page = parsePageLocation(hash, sessionIsLoading, sessionHasUser);
    handledHash = hash;

    navigationStatus = {
        popup,
        page,
        hash,
        previousPage,
        popupCount,
    };
    for (const callback of navigationStatusCallbacks) {
        callback(navigationStatus);
    }
}

function popStateHandler(e: PopStateEvent) {
    console.log("popstate");
    updateNavigationStatus(e.state);
}
addEventListener("popstate", popStateHandler);

function hashChangeHandler(e: HashChangeEvent) {
    console.log("hashchange:", e.newURL);
    const url = new URL(e.newURL);
    if (url.hash === handledHash) {
        // Already handled
        return;
    }
    updateNavigationStatus({
        ...window.history.state,
        hash: url.hash,
    });
}
addEventListener("hashchange", hashChangeHandler);

export function setRouterBehaviour(isLoading: boolean, hasUser: boolean) {
    if (isLoading != sessionIsLoading || hasUser !== sessionHasUser) {
        sessionIsLoading = isLoading;
        sessionHasUser = hasUser;
        updateNavigationStatus(window.history.state);
    }
}

export function setPopup(popup: Popup, force = true) {
    if (!force && navigationStatus.popup !== EMPTY_POPUP) {
        // There is already a popup that we don't wish to override.
        return;
    }
    const popupCount = navigationStatus.popup === EMPTY_POPUP ? 1 : navigationStatus.popupCount + 1;
    const state: Record<string, unknown> = {
        hash: window.location.hash,
        previousPage: navigationStatus.previousPage,
        popupCount,
    };
    if (popup !== EMPTY_POPUP) {
        state.popup = popup;
    }
    window.history.pushState(state, "");
    updateNavigationStatus(state);
}

export function navigateTo(page: Page) {
    const previousPage = page.name === navigationStatus.page.name ? navigationStatus.previousPage + 1 : 1;
    let hash: string = "";
    const p = new URLSearchParams();
    if (page.name === "main") {
        if (page.serverID !== "") {
            p.set("main", `${page.serverID}`);
        }
        if (page.roomID > -1) {
            p.set("roomID", `${page.roomID}`);
        }
    } else if (page.name === "settings") {
        p.set("settings", page.category);
        if (page.serverID !== "") {
            p.set("serverID", `${page.serverID}`);
        }
    } else if (page.name === "view-server") {
        p.set("view-server", `${page.serverID}`);
    } else if (page.name === "mobile-overview") {
        p.set("mobile-overview", `${page.serverID}`);
        p.set("roomID", `${page.roomID}`);
    }
    const paramsStr = p.toString();
    if (paramsStr.length > 0) {
        hash = `#${paramsStr}`;
    } else {
        hash = `#${page.name}`;
    }

    if (navigationStatus.popup === EMPTY_POPUP && hash === navigationStatus.hash) {
        // No point in navigating to the same page again.
        return;
    }

    const state = {
        ...window.history.state,
        hash,
        previousPage,
    };

    // The new location will not keep the old popup.
    delete state.popup;

    window.history.pushState(state, "", hash);
    updateNavigationStatus(state);
}

export function closePage() {
    if (navigationStatus.previousPage === 0) {
        navigateTo({ name: "main", serverID: "", roomID: -1 });
    } else {
        window.history.go(-navigationStatus.previousPage - navigationStatus.popupCount);
    }
}

export function closePopup() {
    if (navigationStatus.popup !== EMPTY_POPUP) {
        window.history.go(-navigationStatus.popupCount);
    }
}

export function latestPage<P extends Page["name"]>(defaultValue: Page & { name: P }) {
    const p = defaultValue.name;
    let previousValue = defaultValue;
    return function (navigationStatus: NavigationStatus) {
        const page = navigationStatus.page;
        if (page.name === p) {
            previousValue = page as Page & { name: P };
        }
        return previousValue;
    };
}

export function pageToServerID(n: NavigationStatus) {
    const name = n.page.name;
    return name === "main" || name === "view-server" || name === "settings" ? n.page.serverID : "";
}

registerDebugCommand("navigationStatus", () => navigationStatus);
