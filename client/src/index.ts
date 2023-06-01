import { isDesktop, isDeveloper } from './options'
import { dispatchSubscribeAll } from './dispatch'
import { confirmSystemAllowsNotifications } from './store'
import { serverNetCodeSubscribe } from './netcode'
import { startUserIsActiveInterval } from './activity_monitor'
import { clientName } from './branding'
import { startLauncherBridge } from './launcher_bridge'
import App from './components/App.svelte'

function removeStartingCover() {
    const cover = document.getElementsByClassName('starting-cover')[0]
    if (cover !== undefined && cover.parentElement !== null) {
        cover.parentElement.removeChild(cover)
    }
}

if (isDeveloper) {
    removeStartingCover()
} else {
    // We only add .css if we are not in develoepr mode.
    const link = document.createElement('link');
    link.addEventListener('load', removeStartingCover)
    link.addEventListener('error', removeStartingCover)
    link.type = 'text/css';
    link.rel = 'stylesheet';
    link.href = './index.css';
    document.head.appendChild(link);
}

async function startApp() {
    document.title = clientName
    await dispatchSubscribeAll()
    serverNetCodeSubscribe()
    startUserIsActiveInterval()

    if (Notification.permission === 'granted') {
        confirmSystemAllowsNotifications()
    }

    const app = new App({
        target: document.getElementById('app-container')!,
        props: {},
    })
    ;(window as any).app = app


    if (isDesktop) {
        // We are running in electron mode.
        const link = document.createElement('link');
        link.type = 'text/css';
        link.rel = 'stylesheet';
        link.href = './static/electron.css';
        document.head.appendChild(link);

        confirmSystemAllowsNotifications()
        startLauncherBridge()
    } else if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            navigator.serviceWorker.register('./service-worker.js');
        })
    }
}

startApp()
//export default app
