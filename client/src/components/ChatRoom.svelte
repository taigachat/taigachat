<script context="module" lang="ts">
const defaultRoomMeta = {
    scroll: 0,
    firstOpen: true,
    restoreScroll: false,
    scrolledToTheEnd: false,
    messageEditing: '',
}
let roomMetas: Record<string, typeof defaultRoomMeta> = {}
</script>

<script lang="ts">
import { loadPersistent, savePersistent } from '../db'
import { setServerRoomEditingMessage, updateServerRoomLastNextMessageID, setServerRoomChunkRange, setServerRoomDraftedMessage, setPopup } from '../store'
import { sendMessage } from '../message_sender'
import type { Immutable } from '../immutable'
import type { TextRoom, TextChunk, Layout } from '../store'
import ChatChunk from './ChatChunk.svelte'
import MessageEditor from './MessageEditor.svelte'
import Icon from './Icon.svelte'
import { attachment, send } from '../icons'
import { fileSelect } from '../svelte_actions'

let plainTextMessage: string = ''

let chunks: Immutable<TextChunk>[] = []
let roomMeta: typeof defaultRoomMeta
export let serverID: number
export let currentUserID: string
export let roomID: number
export let room: Immutable<TextRoom>
export let usersInRoom: readonly string[]
export let layout: Immutable<Layout>
export let attachmentsURL: (fileName: string) => URL
export let profilesURL: (fileName: string) => URL

let lastRoomID: number
let lastServerID: number
let lastStart: number
let lastWanted: number
let lastChunks: Immutable<Record<number, TextChunk>>

let reportedChunkHeights: number[]

function loadRoom(serverID: number, roomID: number, room: Immutable<TextRoom>) {
    const identifier = `${serverID}.${roomID}`
    // TODO: Load draftedMessages?
    let meta = roomMetas[identifier]
    if (meta === undefined) {
        meta = roomMetas[identifier] = { ...defaultRoomMeta }
    }
    if (meta !== roomMeta) {
        roomMeta = meta
    }

    if (serverID !== lastServerID || roomID !== lastRoomID) {
        loadPersistent(`draftedMessage.${serverID}.${roomID}`, '').then((draft) => {
            setServerRoomDraftedMessage(serverID, roomID, draft)
        })
    }

    // TODO: Remove later.
    ;(window as any).debugSetChunkRange = setServerRoomChunkRange

    if (room.chunkCount > 0) {
        if (roomMeta.firstOpen) {
            roomMeta.firstOpen = false
            setServerRoomChunkRange(serverID, roomID, room.chunkCount - 1, 1)
        } else if (roomID !== lastRoomID || serverID !== lastServerID) {
            roomMeta.scrolledToTheEnd = false
            roomMeta.restoreScroll = true
        }
    }

    if (
        lastWanted !== room.chunksWanted ||
        lastStart !== room.chunksStart ||
        lastServerID !== serverID ||
        lastRoomID !== roomID
    ) {
        lastStart = room.chunksStart
        chunks = new Array(room.chunksWanted)

        if (lastWanted !== room.chunksWanted) {
            lastWanted = room.chunksWanted
            reportedChunkHeights = new Array(room.chunksWanted)
        }
        lastChunks = {}
        lastServerID = serverID
        lastRoomID = roomID
    }

    if (room.chunks !== lastChunks) {
        lastChunks = room.chunks
        for (let i = 0; i < room.chunksWanted; i++) {
            const chunk = room.chunks[i + room.chunksStart]
            if (chunk !== undefined) {
                chunks[i] = chunk
            }
        }
    }
}

$: loadRoom(serverID, roomID, room)

let chatRoomContainer: HTMLDivElement
let chatRoomStart: HTMLDivElement
let chatRoomEnd: HTMLDivElement

function tryLoadMore() {
    if (room.chunkCount < 0 || !chatRoomContainer || roomMeta.restoreScroll) {
        return
    }

    const roomScroll = chatRoomContainer.scrollTop
    roomMeta.scroll = roomScroll

    const roomStartHeight = chatRoomStart.offsetTop - chatRoomContainer.offsetTop + chatRoomStart.offsetHeight
    const roomEndHeight = chatRoomEnd.offsetHeight
    const roomHeight = chatRoomContainer.scrollHeight - chatRoomContainer.offsetHeight

    roomMeta.scrolledToTheEnd = roomScroll + 5 >= roomHeight - roomEndHeight 
    //console.log(roomMeta.scrolledToTheEnd, roomScroll, roomHeight, roomEndHeight)
    const roomScrolledToTheBeginning =
        !roomMeta.firstOpen && roomScroll < roomStartHeight && room.chunksStart > 0

    /*console.log('roomHeight', roomHeight, 
                'roomScrolledToTheEnd', room.scrolledToTheEnd,
                'roomScroll', roomScroll, 
                'roomHeight', roomHeight - roomEndHeight, 
                'endChunk', room.endChunk, 
                'roomChunkCount', roomChunkCount)*/

    if (roomScrolledToTheBeginning && chunks[0] !== undefined && room.chunksStart > 0) {
        console.log('load more if possible from top')
        setServerRoomChunkRange(serverID, roomID, room.chunksStart - 1, room.chunksWanted + 1)
        scrollTo(roomStartHeight + 1)
    }

    if (
        roomHeight !== 0 &&
        room.chunksStart + room.chunksWanted < room.chunkCount &&
        roomMeta.scrolledToTheEnd &&
        chunks[chunks.length - 1] !== undefined
    ) {
        console.log('load more if possible from bottom')
        setServerRoomChunkRange(serverID, roomID, room.chunksStart, room.chunksWanted + 1)
        roomMeta.scrolledToTheEnd = false
    }
}

function scrollTo(to: number) {
    roomMeta.scroll = to
    chatRoomContainer.scrollTo(0, to)
}

function chunkGrowCallback(chunkID: number) {
    if (roomMeta.restoreScroll) {
        if (reportedChunkHeights.indexOf(0) === -1) {
            // If we switch back to a room, the user wants to see the same messages as before.
            roomMeta.restoreScroll = false
            //console.log('restoring scroll')
            scrollTo(roomMeta.scroll)
        }
    } else if (chunkID == room.chunksStart || chunkID == room.chunksStart + room.chunksWanted - 1) {
        // This could should only be run if the chunk was either
        // the first or the last chunk being displayed.

        if (roomMeta.firstOpen) {
            // A fresh new room should start at the end.
            roomMeta.firstOpen = false
            scrollTo(chatRoomContainer.scrollHeight)
        } else if (chunkID === room.chunkCount - 1 && roomMeta.scrolledToTheEnd) {
            // To scroll down whenever there is a new message.
            //console.log('scroll down')
            scrollTo(chatRoomContainer.scrollHeight)
        } else if (chunkID === room.chunksStart) {
            // To preserve the scroll as the chat increases in size.
            //scrollTo(chunkHeight + chatRoomStart.scrollHeight)
            scrollTo((reportedChunkHeights[0] || 0) + chatRoomStart.scrollHeight)
        }

        // For the cases where the chunk is very small and we might want to see more messages.
        if (room.chunksWanted < 2) {
            tryLoadMore()
        }
    }
}

function handleChange(message: string) {
    // TODO: Saving every time seems a bit excessive. Set a timeout?
    savePersistent(`draftedMessage.${serverID}.${roomID}`, message)

    setServerRoomDraftedMessage(serverID, roomID, message)
}

async function handlePublish() {
    console.log('usersInRoom:', usersInRoom)
    if (room.draftedMessage === '') {
        return
    }
    if (room.draftedMessage == '/testspam') {
        // TODO: Command interpretation should be done in a more elegant way...
        for (let i = 0; i < 511; i++) {
            await sendMessage(serverID, roomID, 'TEST PLEASE IGNORE', usersInRoom)
        }
    }

    await sendMessage(serverID, roomID, room.draftedMessage, usersInRoom)
    setServerRoomDraftedMessage(serverID, roomID, '')
}

function clearMessageEditor() {
    setServerRoomDraftedMessage(serverID, roomID, '')
}

async function fileUpload(file: File) {
    // TODO: Remove exif if file is a png (and then possible jpg)
    if (file.type.startsWith('image/')) {
        console.log('fetching image height')
        const url = URL.createObjectURL(file)
        const image = new Image()
        image.onload = async () => {
            console.log('image height received')
            await sendMessage(serverID,
                roomID,
                plainTextMessage,
                usersInRoom,
                {
                    name: file.name,
                    mime: file.type,
                    height: image.height,
                },
                file)

            URL.revokeObjectURL(url)
            if (clearMessageEditor) {
                clearMessageEditor()
            }
        }
        image.onerror = (e) => console.error(e)
        image.src = url
    } else {
        await sendMessage(serverID,
            roomID,
            plainTextMessage,
            usersInRoom,
            {
                name: file.name,
                mime: file.type,
            },
            file)
        if (clearMessageEditor) {
            clearMessageEditor()
        }
    }
}

function handlePaste(event: ClipboardEvent) {
    if (event.clipboardData !== null) {
        for (const item of event.clipboardData.items) {
            const file = item.getAsFile()
            if (file !== null) {
                fileUpload(file)
            }
        }
    }
}

function handleDrop(event: DragEvent) {
    event.preventDefault()
    console.log('handle drop')
    if (event.dataTransfer && event.dataTransfer.items) {
        for (const item of event.dataTransfer.items) {
            if (item.kind === 'file') {
                const file = item.getAsFile()
                if (file) {
                    fileUpload(file)
                }
            }
        }
    }
}

function handleDragOver(event: DragEvent) {
    event.preventDefault()
}

$: {
    roomMeta
    if (room.nextMessageID !== room.lastNextMessageID) {
        updateServerRoomLastNextMessageID(serverID, roomID, room.nextMessageID)
    }
}

function handleArrowUpKey() {
    console.log('up key pressed in editor')
    console.log(chunks)
    const lastChunk = room.chunks[room.chunkCount - 1]
    if (lastChunk) {
        const messages = lastChunk.messages
        for(let i = messages.length; i >= 0; i--) {
            const message = messages[i] 
            if (message && !message.deleted && message.msg.userID === currentUserID) {
                roomMeta.messageEditing = message.msg.content || ''
                setServerRoomEditingMessage(serverID, roomID, room.chunkCount - 1, i)
                // TODO: Scroll down or something...
                break
            }
        }
    }
}

</script>

<style>
.chat-room {
    display: flex;
    height: 100%;
    flex-flow: column nowrap;
    position: relative;
}
.chat-room-content {
    flex-shrink: 1;
    padding: 10px;
    overflow-y: scroll;
    overflow-x: hidden;
    height: 100%;
    overflow-wrap: anywhere;
}

.chat-room-bottom {
    font-size: 1.05em;
    flex-grow: 1;
    margin: 10px;
    padding: 10px;
    background-color: var(--background-opacity);
    border-radius: 5px;
    display: flex;
    flex-flow: row nowrap;
    align-items: end;
}
.chat-room-bottom div {
    fill: var(--blue1);
    padding: 0 3px;
}
.chat-room-bottom div:hover {
    fill: var(--white1);
}

.chat-room-emoji-picker {
    filter: grayscale(90%);
    /*padding-right: 5px;*/
}
.chat-room-emoji-picker:hover {
    filter: none;
}

.chat-room-title {
    width: 100%;
    flex-grow: 0;
    flex-shrink: 0;
    padding: 15px;
    font-size: 1.2em;
    display: flex;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

}
.chat-room-title-divider {
    margin: 0 15px;
    height: 15px;
    width: 1px;
    background-color: var(--white1);
}
.chat-room-description {
    font-size: 0.7em;
    white-space: normal;
    overflow: hidden;
    max-height: 95px;
}
</style>

<svelte:window on:paste={handlePaste} />

<div class="chat-room" on:drop={handleDrop} on:dragover={handleDragOver}>
    {#if !layout.mobile}
        <div class="chat-room-title magic-top-height">
            # {room.name}
            {#if room.description}
                <div class="chat-room-title-divider" />
                <div class="chat-room-description">
                    {room.description}
                </div>
            {/if}
        </div>
    {/if}
    <div
        on:click={tryLoadMore}
        class="chat-room-content pretty-scroll"
        bind:this={chatRoomContainer}
        on:scroll={tryLoadMore}>
        <div bind:this={chatRoomStart} class="chat-room-start">
            {#if room.chunksStart > 0}
                Loading more messages ...
            {/if}
        </div>
        {#each chunks as chunk, i}
            <ChatChunk
                bind:reportedChunkHeight={reportedChunkHeights[i]}
                {currentUserID}
                {profilesURL}
                {attachmentsURL}
                {room}
                {roomMeta}
                {roomID}
                {serverID}
                {chunkGrowCallback}
                chunkID={room.chunksStart + i}
                parsedMessages={chunk ? chunk.messages : []} />
        {/each}
        <div on:click={tryLoadMore} bind:this={chatRoomEnd} class="chat-room-end">
            {#if room.chunksStart + room.chunksWanted < room.chunkCount}
                Loading more messages ...
            {/if}
        </div>
    </div>
    <div class="chat-room-bottom">
        <MessageEditor value={room.draftedMessage} onarrowupkey={handleArrowUpKey} onchange={handleChange} onpublish={handlePublish} />
        <div on:click={() => setPopup({ emojiPicker: true })} class="chat-room-emoji-picker">
            {String.fromCodePoint(0x1f970)}
        </div>
        <div use:fileSelect={fileUpload}>
            <Icon icon={attachment} size="20" />
        </div>
        <div on:click={handlePublish}>
            <Icon icon={send} size="20" />
        </div>
    </div>
</div>
