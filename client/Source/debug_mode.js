import { debugMode } from "./options";

/** @type {Record<string, (...args: any[]) => any>} */
const debugCommands = {};

if (debugMode) {
    const windowWithDebug = /** @type {{debug: typeof debugCommands}} */ (/** @type {unknown} */ (window));

    windowWithDebug.debug = debugCommands;
}

/**
 * @param {string} commandName
 * @param {(...args: any[]) => any} command
 */
export function registerDebugCommand(commandName, command) {
    if (!debugMode) {
        return;
    }

    debugCommands[commandName] = command;

    return;
}
