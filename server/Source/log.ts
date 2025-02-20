import config from "./config.js";

function noop() {}
export function getLog(module: string) {
    const shouldLog = config.logModules.includes(module);
    const prefix = module + ":";
    function logInfo(...args: any[]) {
        console.log(prefix, ...args);
    }
    function logError(...args: any[]) {
        console.error("ERROR", prefix, ...args);
    }
    return {
        info: shouldLog ? logInfo : noop,
        error: logError,
    };
}
