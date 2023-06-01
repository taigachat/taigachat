// TODO: come up with a better name.

import { actionsData } from './schema'
import type { ActionsKey, ActionData } from './schema'
import { setServerErrorFeedback, ClientUser, ConnectivityInfo, MainStore } from './store'
import { asMutable, Immutable } from './immutable'
import { isDeveloper, appVersion } from './options'
import { signNonce } from './user_chains'

let clientUsers: Immutable<Record<string, ClientUser>> = {}

const volatile = {
    userIsActive0: true
}

const useFormData: Record<string, boolean> = {
    newMessage0: true,
    setProfile0: true,
}

const connectivityInfos: Map<number, ConnectivityInfo> = new Map()

export function actionsIngestServerConnectivityInfo(serverID: number, connectivityInfo: ConnectivityInfo) {
    connectivityInfos.set(serverID, connectivityInfo)
}

export function getServerAuthenticatedURL(connectivityInfo: ConnectivityInfo, endpoint: string) {
    const developer = isDeveloper ? '&isDeveloper=1' : ''
    const url = new URL(`/${endpoint}?token=${connectivityInfo.token}&appVersion=${appVersion}${developer}`,
                        connectivityInfo.url)
    return url.href
}

function argsToFormData(args: any[], userChain?: string, nonce?: string): FormData {
    const formData = new FormData()
    if (userChain) {
        formData.append('userChain', userChain)
    }
    if (nonce) {
        formData.append('nonce', nonce)
    }
    for (const arg of args) {
        //console.log('arg:', arg)
        if (arg instanceof File) {
            formData.append('arg', arg, arg.name)
        } else {
            formData.append('arg', JSON.stringify(arg))
        }
    }
    return formData
}

class ActionError {
    text: string
    constructor(text: string) {
        this.text = text
    }
}

export const onServer: {
    [ActionName in ActionsKey]: (serverID: number, ...data: ActionData<ActionName>) => Promise<void>
} = {} as any

// TODO: Maybe instead of throwing, we could return true/false?

async function performAction(serverID: number, url: string, data: any[], connectivityInfo: ConnectivityInfo, isFormData?: boolean, ) {
    let response = await fetch(url, {
        method: 'POST',
        body: isFormData ? argsToFormData(data) : JSON.stringify({
            args: data,
        })
    })
    if (response.status === 401) {
        const clientUser = clientUsers[connectivityInfo.userID]
        if (clientUser === undefined) {
            // TODO: is this the best way to handle this?
            setServerErrorFeedback(serverID, 'no user selected for server: ' + serverID)
            return
        }
        const nonce = await response.text()
        const signedNonce = await signNonce(asMutable(clientUser.key), nonce)
        response = await fetch(url, {
            method: 'POST',
            body: isFormData ? argsToFormData(data, clientUser.chain, signedNonce) : JSON.stringify({
                args: data,
                userChain: clientUser.chain,
                nonce: signedNonce
            })
        })
    }
    if (response.status === 400) {
        const text = await response.text()
        setServerErrorFeedback(serverID, text)
        return
    }

    if (!response.ok) {
        const text = await response.text()
        throw new ActionError(text)
    }
}

for (const actionName in actionsData) {
    const isFormData = useFormData[actionName]
    onServer[actionName as ActionsKey] = async (serverID: number, ...data) => {
        const connectivityInfo = connectivityInfos.get(serverID)
        if (connectivityInfo === undefined || !connectivityInfo.enabled) {
            return
        }
        const url = getServerAuthenticatedURL(connectivityInfo, 'action')
        const urlExtra = `${url}&action=${actionName}`
        try {
            await performAction(serverID, urlExtra, data, connectivityInfo, isFormData)
        } catch (e) {
            // TODO: Report in a better way
            console.error(`error on server ${serverID}`)
            throw e
        }
    }
}

export async function handleStoreChanged(store: Immutable<MainStore>) {
    clientUsers = store.clientUsers
}

