// TODO: The goal of this file is to make it so that
// mainStore subscribe doesn't have to maintain a list
// and can instead have just one single function to call
// if anything changes

import { mainStore } from './store'

import { handleStoreChanged as handleStoreChangedActs } from './acts'
import { handleStoreChanged as handleStoreChangedNetCode } from './netcode'
import { handleStoreChanged as handleStoreChangedKeybinds } from './keybinds'
import { handleStoreChanged as handleStoreChangedActivityMonitor } from './activity_monitor'
import { handleStoreChanged as handleStoreChangedCall} from './call_controller'
import { handleStoreChanged as handleStoreChangedUpdater} from './update_checker'
import { handleStoreChanged as handleStoreChangedActions} from './actions'
import { handleStoreChanged as handleStoreChangedURLs} from './urls'

export async function dispatchSubscribeAll() {
    await mainStore.setUpdateHandler(async s => {
        //console.log('handlers have been called', s)
        await handleStoreChangedActs(s)
        await handleStoreChangedNetCode(s)
        handleStoreChangedURLs(s)
        handleStoreChangedActions(s)
        handleStoreChangedKeybinds(s)
        handleStoreChangedActivityMonitor(s)
        handleStoreChangedCall(s)
        handleStoreChangedUpdater(s)
        await mainStore.runGuiListners(s)
    })
}


