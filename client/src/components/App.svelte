<script lang="ts">
import GlassmorphicBackground from './GlassmorphicBackground.svelte'
import Toasts from './Toasts.svelte'
import WindowTitleBar from './WindowTitleBar.svelte'
import LeftPanel from './LeftPanel.svelte'
import ChatRoom from './ChatRoom.svelte'
import RightPanel from './RightPanel.svelte'
import Login from './Login.svelte'
import Settings from './Settings.svelte'
import UserCard from './UserCard.svelte'
import OfflineAuthenticator from './OfflineAuthenticator.svelte'
import EmojiPicker from './EmojiPicker.svelte'
import ImageViewer from './ImageViewer.svelte'
import ConfirmDeleteMessage from './ConfirmDeleteMessage.svelte'
import ConnectWithCentral from './ConnectWithCentral.svelte'
import InviteWithCentral from './InviteWithCentral.svelte'
import MobileTopBar from './MobileTopBar.svelte'
import Changelog from './Changelog.svelte'

import { fade } from '../svelte_actions'

import { changelog } from '../changelog'
import { canRoles } from '../roles'

import { RankCategory, setPopup, mainStore, setLayout, isMobileDevice, UNLOADED_CLIENT_USERS } from '../store'
import { handleBrowserKeyPressed } from '../keybinds'
import { safeURL } from '../join_url'

function handleKeyDown(e: any) {
    handleBrowserKeyPressed(e.key, true)
}

function handleKeyUp(e: any) {
    handleBrowserKeyPressed(e.key, false)
}

$: viewedServerID = $mainStore.viewedServerID
$: viewedServer = $mainStore.servers[viewedServerID]
$: viewedServerUserID = viewedServer ? viewedServer.connectivityInfo.userID : ''
$: viewedRoomID = viewedServer ? viewedServer.viewedRoomID : -1
$: viewedRoom = viewedServer && viewedServer.rooms[viewedRoomID]
$: viewedRoomDraftedMessage = viewedRoom ? viewedRoom.draftedMessage : ''
$: viewedServerAttachmentsURL = safeURL(viewedServer && viewedServer.attachmentsURL)
$: viewedServerProfilesURL = safeURL(viewedServer && viewedServer.profilesURL)
$: viewedServerUsers = viewedServer ? viewedServer.users : {}
//$: viewedServerEmbedURL = viewedServer ? createEmbedURL(viewedServer.connectivityInfo) : ''

const EMPTY_POPUP = {}
let lastPopup: any = null
function outsideClickHandler() {
    if (lastPopup === $mainStore.popup) {
        if ($mainStore.popup !== EMPTY_POPUP) {
            setPopup(EMPTY_POPUP)
        }
    } else {
        lastPopup = $mainStore.popup
    }
}
function insideClickHandler() {
    lastPopup = null
}

$: popup = $mainStore.popup

function isNotEmpty(obj: any) {
    for (const v in obj) {
        if (obj[v] !== undefined) {
            return true
        }
    }
    return false
}

$: clientUsers = $mainStore.clientUsers


let usersInViewedRoom: string[] = []
let participantsInViewedRoom: RankCategory[]
$: if (viewedRoom !== undefined && viewedServer !== undefined) {
    const usersInRoom: string[] = []

    const rankedUsers: Record<number, RankCategory> = {}
    const onlineRanklessUsers: RankCategory = { name: 'Online', rank: 0, users: [] }
    const offlineUsers: RankCategory = { name: 'Offline', rank: 0, users: [] }

    if (viewedRoom.permissions) {
        for (const role of viewedRoom.permissions) {
            if (role !== undefined) {
                rankedUsers[role.roleID] = {
                    name: role.name || '',
                    rank: role.rank || 0,
                    users: [],
                }
            }
        }
    }
    // TODO: The above if statement seems quite unnecessary

    for (const role of viewedServer.serverRoles) {
        rankedUsers[role.roleID] = {
            name: role.name || '',
            rank: role.rank ||0,
            users: [],
        }
    }

    console.log(viewedServerUsers.length)
    for (const userID in viewedServerUsers) {
        const user = viewedServerUsers[userID]!
        const roles = viewedServer.roleAssignments[userID] || []
        if (canRoles('read_chat', roles, [viewedServer.serverRoles, viewedRoom.permissions || []])) {
            // TODO: Do we really need a separate entry? Could we not just send in the user object directly?
            usersInRoom.push(userID)
            if (userID in viewedServerUsers) {
                const roleAssignments = roles
                    .filter((r) => r in rankedUsers)
                    .map((r: number) => rankedUsers[r] as RankCategory)
                    .sort((a, b) => b.rank - a.rank)
                const roleAssignment = roleAssignments[0]
                if (roleAssignment !== undefined) {
                    roleAssignment.users.push(user)
                } else {
                    onlineRanklessUsers.users.push(user)
                }
            } else {
                offlineUsers.users.push(user)
            }
        }
    }

    const sortedRanks = Object.values(rankedUsers)
        .filter((e) => e.users.length > 0)
        .sort((a: any, b: any) => b.rank - a.rank)

    participantsInViewedRoom = [...sortedRanks, onlineRanklessUsers, offlineUsers]
    usersInViewedRoom = usersInRoom
} else {
    participantsInViewedRoom = []
    usersInViewedRoom = []
}

function handleWindowResized() {
    if (isMobileDevice) {
        return
    }
    const useMobileLayout = window.innerHeight < 600 || window.innerWidth < 500
    console.log('mobile layout:', useMobileLayout)
    if (useMobileLayout !== $mainStore.layout.mobile) {
        setLayout({
            ...$mainStore.layout,
            mobile: useMobileLayout,
            leftPanel: !useMobileLayout,
            rightPanel: !useMobileLayout,
        })
    }
}

handleWindowResized()

$: layout = $mainStore.layout

$: autoUpdater = $mainStore.autoUpdater

let xDown = 0                                                        
let yDown = 0
let startFromLeft = false
let startFromRight = false

function handleTouchStart(evt: TouchEvent) {
    const firstTouch = evt.touches[0]
    if (firstTouch) { 
        xDown = firstTouch.clientX
        yDown = firstTouch.clientY
        startFromLeft = firstTouch.clientX < window.innerWidth * 0.3
        startFromRight = firstTouch.clientX > window.innerWidth * 0.7
    }
}
                                                                         
function handleTouchMove(evt: TouchEvent) {
    if (!xDown || !yDown) {
        return
    }

    if (evt.touches[0] !== undefined) {
        const xUp = evt.touches[0].clientX
        const yUp = evt.touches[0].clientY

        const xDiff = xDown - xUp
        const yDiff = yDown - yUp
                                                                             
        if (Math.abs(xDiff) > Math.abs(yDiff)) {
            if (xDiff > 0) {
                if (startFromRight || layout.leftPanel) {
                    setLayout({
                        ...layout,
                        rightPanel: !layout.leftPanel,
                        leftPanel: false,
                    })
                }
            } else {
                if (startFromLeft || layout.rightPanel) {
                    setLayout({
                        ...layout,
                        leftPanel: !layout.rightPanel,
                        rightPanel: false
                    })
                }
            }                       
        } else {
            if (yDiff > 0) {
                /*console.log('swipe down')*/
            } else { 
                /*console.log('swipe up')*/
            }                                                                 
        }
        xDown = 0
        yDown = 0
    }
}

//$: userActivity = $mainStore.userActivity

$: lastActivityCheck = $mainStore.lastActivityCheck

$: navigatedLocation = $mainStore.clientUsers === UNLOADED_CLIENT_USERS
                       ? 'loading'
                       : isNotEmpty(clientUsers)
                       ? $mainStore.navigationStack[$mainStore.navigationStack.length - 1]
                       : 'login'

$: popupOpen = isNotEmpty($mainStore.popup) && navigatedLocation !== 'login'
</script>

<style>
.app-layout {
    display: flex;
    flex-flow: column nowrap;
}

.panels {
    display: flex;
    width: 100%;
    position: relative;
    overflow: hidden;
    flex-grow: 1;
    flex-flow: row nowrap;

}

.server-list {
    width: 340px;
    flex-shrink: 0;
}

.chat-room {
    flex-grow: 1;
    min-width: 0;
}

.right-panel {
    width: 200px;
    flex-shrink: 0;
}

.popup-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    background-color: #ffffff0f;
    z-index: 300;
}

.popup-body {
    position: absolute;
    min-width: 300px;
    border-radius: 10px;
    border-color: var(--blue2);
    box-shadow: 1px 6px 8px 0px #00000070;
    padding: 25px;
    transform: translate(-50%, -50%);
    top: 50%;
    left: 50%;
    pointer-events: all;
    backdrop-filter: blur(8px);
    background-color: var(--background-opacity);
}

.mobile-layout .server-list {
    position: absolute;
    top: 0;
    left: -100%;
    height: 100%;
    z-index: 100;
    transition: left 300ms ease;
}

.mobile-layout .server-list.open {
    left: 0;
}

.mobile-layout .right-panel {
    position: absolute;
    top: 0;
    right: -100%;
    height: 100%;
    z-index: 100;
    transition: right 300ms ease;
}

.mobile-layout .right-panel.open {
    right: 0;
}
</style>

<svelte:window on:resize={handleWindowResized} on:keydown={handleKeyDown} on:keyup={handleKeyUp} />
<svelte:body on:click={outsideClickHandler} on:touchstart|passive={handleTouchStart} on:touchmove|passive={handleTouchMove}/>

<WindowTitleBar />
<GlassmorphicBackground showBalls={navigatedLocation !== 'main'}>
    <div class="app-layout" class:mobile-layout={layout.mobile}>
        <div use:fade={navigatedLocation === 'login'}>
            {#if navigatedLocation === 'login'}
                <Login allowedToClose={isNotEmpty(clientUsers)} />
            {/if}
        </div>
        <div use:fade={navigatedLocation === 'settings'}>
            <Settings />
        </div>
        <div use:fade={navigatedLocation === 'main'}>
            {#if layout.mobile}
                <MobileTopBar {layout} title={viewedRoom ? ('#'+viewedRoom.name) : ''} />
            {/if}
            <div class="panels">
                <div class="server-list" class:open={layout.leftPanel}>
                    <!-- TODO: use real value instead profilesURL -->
                    <LeftPanel
                        voice={$mainStore.voice}
                        profilesURL={viewedServerProfilesURL}
                        serverIDs={$mainStore.serverIDs}
                        showAddServer={$mainStore.showAddServer}
                        {viewedServerID}
                        servers={$mainStore.servers}
                        users={viewedServerUsers} />
                </div>
                <div class="chat-room">
                    {#if viewedRoom}
                        <ChatRoom
                            {layout}
                            profilesURL={viewedServerProfilesURL}
                            attachmentsURL={viewedServerAttachmentsURL}
                            usersInRoom={usersInViewedRoom}
                            roomID={viewedRoomID}
                            serverID={viewedServerID}
                            currentUserID={viewedServerUserID}
                            room={viewedRoom} />
                    {/if}
                </div>
                <div class="right-panel panel-glass panel-border" class:open={layout.rightPanel}>
                    <RightPanel
                        profilesURL={viewedServerProfilesURL}
                        participants={participantsInViewedRoom}
                        {lastActivityCheck} />
                </div>
            </div>
        </div>
        {#if popupOpen}
            <div class="popup-container">
                <div class="panel-glass popup-body" on:click={insideClickHandler}>
                    <!-- TODO: the escape button should be able to close popups as well. -->

                    <UserCard {popup}
                              {viewedServer}
                              user={viewedServer && viewedServer.users[popup.viewUserID || '']}
                              audioLevels={$mainStore.audioLevels} />
                    <EmojiPicker
                        {popup}
                        {viewedServerID}
                        {viewedRoomID}
                        draftedMessage={viewedRoomDraftedMessage} />
                    <ImageViewer {popup} />
                    <OfflineAuthenticator {popup} {clientUsers} />
                    <ConfirmDeleteMessage {popup} {viewedServerID} />
                    <ConnectWithCentral {popup} {clientUsers} />
                    <InviteWithCentral {popup} {clientUsers} />
                    <Changelog {changelog} changelogIndex={$mainStore.miscConfig.changelogIndex} showChangelog={popup.showChangelog} />
                </div>
            </div>
        {/if}
    </div>
    <Toasts toasts={$mainStore.toasts} {autoUpdater}/>
</GlassmorphicBackground>
