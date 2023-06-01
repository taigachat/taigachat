/// This file detects launch options and acts accordingly...

import { fallbackCentralURL, fallbackAutoUpdateURL, clientName, fallbackServerManagerURL } from './branding'

export const options = new URLSearchParams(location.search)

// TODO: So that a link can't set these values, we should have a value which validates
// TODO: Or we just prevent all nagivation, don't we already do this?

// TODO: More checks?
export const isDesktop = options.get('desktop') === '1'

export const isDeveloper = options.get('developer') === '1'

export const autoJoinURL = options.get('autoJoinURL')

export const platform = options.get('platform') || 'web'

export const packageVersion = options.get('version')

export const launcherPortSecret = options.get('launcher') || ''

export const appVersion = getBuildOption('version', 'VERSIONLESS')

export const defaultCentralURL = getBuildOption('central_url', fallbackCentralURL)

export const autoUpdateURL = getBuildOption('auto_update_url', fallbackAutoUpdateURL)

export const defaultServerManagerURL = getBuildOption('server_manager_url', fallbackServerManagerURL)

function getBuildOption(name: string, defaultValue: string) {
    const searchFor = 'taigachat:' + name
    for (const tag of Array.from(document.getElementsByTagName('meta'))) {
        if (tag.name === searchFor) {
            if (tag.content.startsWith('%SNOWPACK_PUBLIC_')) {
                return defaultValue
            } else {
                return tag.content || defaultValue
            }
        }
    }

    return defaultValue
}

if (platform !== 'web' && !isDeveloper && packageVersion !== appVersion) {
    console.warn('WARNING: App and package version differ (try running snowpack build)', appVersion, packageVersion)
}

console.log(`running ${clientName} ${appVersion}${isDeveloper ? ' (developer)' : ''} on ${platform}`)
