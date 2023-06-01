import type { ServerInfo } from './schema.ts'
import { documentChanged, openDocSingleton, DocumentSavable } from './json.ts'

let serverInfo: ServerInfo
export let serverInfoSavable: DocumentSavable<ServerInfo>

export function setServerName(name: string) {
    serverInfo.name = name
    documentChanged(serverInfoSavable)
}

export async function loadData() {
    const container = openDocSingleton('serverInfo', {
        name: 'Unnamed Server'
    })
    const entry = await container.open()
    serverInfo = entry.data
    serverInfoSavable = [container, entry]
}



