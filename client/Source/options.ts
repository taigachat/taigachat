/// This file detects launch options and acts accordingly...

import {
    centralURL,
    autoUpdateURL as fallbackAutoUpdateURL,
    clientName,
    notificationServerURL as fallbackNotificationServerURL,
    serverManagerURL as fallbackServerManagerURL,
    appVersion as appVersionEdition,
    isDeveloper as isDeveloperEdition,
} from "./edition";

export const options = new URLSearchParams(location.search);

// TODO: So that a link can't set these values, we should have a value which validates
// TODO: Or we just prevent all nagivation, don't we already do this?

const loadedFromFile = window.location.protocol === "file:";
const loadedFromLocal = window.location.hostname === "localhost";

export const autoJoinURL = options.get("autoJoinURL");

export const autoViewRoomID = options.get("autoViewRoomID") || "";

export const joinAnonymously = options.get("joinAnonymously") === "1";

export const debugMode = options.get("debugMode") === "1";

export const isElectron = loadedFromFile || (loadedFromLocal && options.has("launcher"));

// We only allow launcher communication if loading from localhost or a file.
// This is done so that no secrets are accidentally leaked.
export const launcherPortSecret = loadedFromLocal || loadedFromFile ? options.get("launcher") || "" : "";

export const hasLauncher = launcherPortSecret !== "";

export const platform = isElectron ? options.get("platform") || "generic-electron" : "web";

// TODO: In the future, we should be able to change these in the UI. and require a restart.
// TODO: Once that is finished, we do not need to call them "defaults" anymore.
// TODO: Also, we couuld probably remove the dependence on options.ts in favour of edition.js
export const defaultCentralURL = centralURL; // TODO: Call it fast login URL instead.
export const autoUpdateURL = fallbackAutoUpdateURL;
export const defaultServerManagerURL = fallbackServerManagerURL;
export const isDeveloper = isDeveloperEdition;
export const appVersion = appVersionEdition;

// TODO: Better name might be notificationMultiplexer? or muxer
export const defaultNotificationServerURL = fallbackNotificationServerURL;
//export const defaultNotificationServerURL = 'http://localhost:9090/'

// TODO: Move to index.ts
console.log(`running ${clientName} ${appVersion}${isDeveloper ? " (developer)" : ""} on ${platform}`);
