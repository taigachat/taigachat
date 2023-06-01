import type { Immutable } from './immutable'
import { defaultMiscConfig, MainStore } from './store'
import { defaultCentralURL, defaultServerManagerURL } from './options'

let oldMiscConfig = defaultMiscConfig

export function getCentralURL(): string {
    return oldMiscConfig.overrideCentralURL || defaultCentralURL
}

export function getServerManagerURL(): string {
    return oldMiscConfig.overrideServerManagerURL || defaultServerManagerURL
}

export function handleStoreChanged(s: Immutable<MainStore>) {
    oldMiscConfig = s.miscConfig
}
