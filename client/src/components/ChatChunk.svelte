<svelte:options immutable={true}/>
<script lang="ts">
import type { Immutable } from '../immutable'
import Icon from './Icon.svelte'
import MessageEditor from './MessageEditor.svelte'
import { edit, remove, download } from '../icons'
import { afterUpdate } from 'svelte'
import { FLAG_BOLD, FLAG_ITALIC, FLAG_STRIKE, FLAG_UNDERLINE, FLAG_NEWLINE, FLAG_LINK } from '../message_format'
import { TextRoom, ParsedMessage, ParsedMessageNormal, setPopup, AttachmentType, setServerRoomEditingMessage, setMediaVolume } from '../store'
import { onServer } from '../actions'
import { currentDefaultMediaVolume } from '../acts'
import { openURL } from '../sal';
import { profileLoader, profileLoad } from '../profiles'

export let chunkGrowCallback: (chunkID: number) => void
export let parsedMessages: Immutable<ParsedMessage[]>
export let room: Immutable<TextRoom>
export let roomID: number
export let chunkID: number
export let serverID: number
export let reportedChunkHeight: number | undefined
export let roomMeta: { messageEditing: string }
export let currentUserID: string
export let attachmentsURL: (fileName: string) => URL
export let profilesURL: (fileName: string) => URL

let lastRoomID: number
let lastChunkID: number
let lastMessageCount: number

let chunkContainer: HTMLDivElement

function attachmentURL(attachmentsURL: (fileName: string) => URL, message: Immutable<ParsedMessageNormal>) {
    if (!message.msg.attachment) {
        console.error('attachmentURL called on message without attachment')
        return ''
    }
    return attachmentsURL(message.msg.attachment.fileName).href
}


function bindClickUser(i: number) {
    return () => {
        const parsedMessage = parsedMessages[i]
        if (parsedMessage !== undefined && !parsedMessage.deleted) {
            setPopup({
                viewUserID: parsedMessage.msg.userID,
            })
        }
    }
}
function bindDeleteMessage(messageIndex: number) {
    return () => {
        setPopup({
            confirmDeleteMessage: {
                serverID,
                roomID,
                chunkID,
                messageIndex,
            },
        })
    }
}
function bindStartEditing(i: number) {
    return () => {
        const parsedMessage = parsedMessages[i]
        if (parsedMessage && !parsedMessage.deleted) {
            roomMeta.messageEditing = parsedMessage.msg.content || ''
            setServerRoomEditingMessage(serverID, roomID, chunkID, i)
        }
    }
}

function bindViewImage(i: number) {
    return () => {
        const parsedMessage = parsedMessages[i]
        if (parsedMessage !== undefined && !parsedMessage.deleted) {
            setPopup({ viewImage: attachmentURL(attachmentsURL, parsedMessage) })
        }
    }
}

function handleUpdate() {
    reportedChunkHeight = chunkContainer.scrollHeight
    const contentIncreased = parsedMessages.length > lastMessageCount
    //console.log('handleUpdate', chunkID, height, contentIncreased)
    if (reportedChunkHeight !== 0 && contentIncreased) {
        //console.log('chunk grown: ', chunkID)
        chunkGrowCallback(chunkID)
        lastMessageCount = parsedMessages.length
    }
}

async function cancelEditing() {
    await setServerRoomEditingMessage(serverID, roomID, -1, -1)
    roomMeta.messageEditing = ''
}

function bindFinishEditing(i: number) {
    return async () => {
        await onServer.editMessage0(serverID, roomID, chunkID, i, roomMeta.messageEditing)
        cancelEditing()
    }
}

function changeEditing(m: string) {
    roomMeta.messageEditing = m
}

let rerenderNameTags = 0
const nameTags: string[] = []

function getNameTag(n?: string, _num?: number) {
    // TODO: this is just a hack to get name-tag to rerender while
    // svelte option immutable is on
    return n
}

function bindSetNameTag(i: number) {
    return (name: string) => {
        if (nameTags[i] !== name) {
            nameTags[i] = name
            rerenderNameTags += 1
        }
    }
}

$: if (roomID !== lastRoomID || chunkID !== lastChunkID) {
    lastMessageCount = 0
    lastRoomID = roomID
    lastChunkID = chunkID
    reportedChunkHeight = 0
}

afterUpdate(handleUpdate)

function handleURL(url: string) {
    return (e: MouseEvent) => {
        e.preventDefault()
        openURL(url)
        return false
    }
}

function downloadURL(url: string) {
    return (e: MouseEvent) => {
        e.preventDefault()
        openURL(url)
        return false
    }
}

const mediaVolumeChanged: svelte.JSX.EventHandler<Event, HTMLMediaElement> = (event) => {
    setMediaVolume(event.currentTarget.volume)
}

const mediaPlaying: svelte.JSX.EventHandler<Event, HTMLMediaElement> = (event) => {
    event.currentTarget.volume = currentDefaultMediaVolume
}

</script>

<style>
.chunk-message {
    user-select: text;
    letter-spacing: -4px;
}

.chunk-message span {
    white-space: pre-wrap;
    letter-spacing: normal;
}

.chunk-message-container {
    display: flex;
    position: relative;
}

.chunk-message .message-bold {
    font-variation-settings: var(--bold-text);
}

.chunk-message .message-italic {
    font-style: italic;
}

.chunk-message .message-strike {
    text-decoration: line-through;
}

.chunk-message .message-underline {
    text-decoration: underline;
}

.chunk-message .message-strike.message-underline {
    text-decoration: underline line-through;
}

.chunk-avatar {
    border-radius: 50%;
    height: 40px;
    width: 40px;
    margin: 0 10px 10px 0;
    pointer-events: all;
}

.chunk-username {
    font-variation-settings: 'wght' 600;
    color: #c065cb;
    text-shadow: 2px 2px 4px #00000063;
    letter-spacing: normal;
}

.chunk-attachment {
    margin-top: 8px;
}

.chunk-attachment video {
    background-color: black;
}

.chunk-attachment-image {
    max-width: 500px;
    height: 100%;
    pointer-events: all;
    object-fit: contain;
    object-position: top;
}

.chunk-message-options {
    display: none;
    position: absolute;
    top: 5px;
    right: 5px;
    fill: var(--blue1);
}

.chunk-message-options span:hover {
    fill: var(--white1);
}

.chunk-message-container:hover .chunk-message-options {
    display: inline-block;
}

.chunk-download-file {
    display: block;
    margin: 10px;
    padding: 10px;
    border-radius: 5px;
    text-decoration: none;
    fill: var(--white1);
    cursor: pointer;
}

.chunk-download-file:hover {
    fill: var(--background-opacity);
    color: var(--background-opacity);
}

.chunk-attachment {
    margin-bottom: 12px;
}

.chunk-link {
    color: var(--blue1);
    cursor: pointer;
}

</style>

<div bind:this={chunkContainer}>
    {#each parsedMessages as message, i}
        {@const setNameTag = bindSetNameTag(i)}
        {@const deleteMessage = bindDeleteMessage(i)}
        {@const startEditing = bindStartEditing(i)}
        {@const clickUser = bindClickUser(i)}
        {@const finishEditing = bindFinishEditing(i)}
        {@const viewImage = bindViewImage(i)}
        {#if !message.deleted}
            <div class="chunk-message-container">
                <div class="chunk-message-options">
                    <!-- TODO: Should we check for permissions? -->
                    <span on:click={deleteMessage}><Icon icon={remove} size="24" /></span>
                    {#if message.msg.userID === currentUserID}
                        <!-- TODO: Do we do a more advanced check in the future? -->
                        <span on:click={startEditing}><Icon icon={edit} size="24" /></span>
                    {/if}
                </div>

                <!-- TODO: Round the corners if the image is big enough. -->
                <img
                    alt="avatar of {getNameTag(nameTags[i], rerenderNameTags)}"
                    class="chunk-avatar"
                    use:profileLoader={profileLoad(setNameTag,
                                                   message.msg.userID,
                                                   message.profileTimestamp,
                                                   profilesURL)}
                    on:click={clickUser} />

                <div class="chunk-message">
                    {#if chunkID === room.editingMessageChunkID && i === room.editingMessageIndex}
                        <div class="chunk-username" >
                            {getNameTag(nameTags[i], rerenderNameTags)}
                            -
                            (editing)
                        </div>
                        <MessageEditor
                            value={roomMeta.messageEditing}
                            oncancel={cancelEditing}
                            onchange={changeEditing}
                            onpublish={finishEditing} />
                    {:else}
                        <div class="chunk-username">
                            {getNameTag(nameTags[i], rerenderNameTags)}
                            - 
                            {message.time}{message.msg.edited ? ' (edited)' : ''}
                        </div>
                        {#each message.components as component}
                            {#if component.flags === FLAG_NEWLINE}
                                <br />
                            {/if}
                            <span
                                class:message-bold={component.flags & FLAG_BOLD}
                                class:message-underline={component.flags & FLAG_UNDERLINE}
                                class:message-italic={component.flags & FLAG_ITALIC}
                                class:message-strike={component.flags & FLAG_STRIKE}>
                                {#if component.flags & FLAG_LINK}
                                    <span class="chunk-link" on:click={handleURL(component.text)}>{component.text}</span>
                                {:else}
                                    {component.text}
                                {/if}

                            </span>
                        {/each}

                        {#if message.attachmentType !== AttachmentType.None && message.msg.attachment}
                            {@const attachment = message.msg.attachment}
                            <div class="chunk-attachment">
                                {#if !attachment.unveiled}
                                    <span>
                                        Now Loading!
                                    </span>
                                {:else if message.attachmentType === AttachmentType.Image}
                                    <div
                                        on:click={viewImage}
                                        style="height: {Math.min(attachment.height || 0, 282)}px;">
                                        <img
                                            alt="attachment"
                                            loading="lazy"
                                            class="chunk-attachment-image"
                                            src={attachmentURL(attachmentsURL, message)} />
                                    </div>
                                {:else if message.attachmentType === AttachmentType.Video}
                                    <!-- TODO: Does the browser always load the file directly? If, so that is probably bad... -->
                                    <video on:playing={mediaPlaying} on:volumechange={mediaVolumeChanged} width="400" height="224" controls>
                                        <source
                                            src={attachmentURL(attachmentsURL, message)}
                                            type={message.msg.attachment.mime} />
                                        <track kind="captions" />
                                    </video>
                                {:else if message.attachmentType === AttachmentType.Audio}
                                    <audio on:playing={mediaPlaying} on:volumechange={mediaVolumeChanged} controls>
                                        <source
                                            src={attachmentURL(attachmentsURL, message)}
                                            type={message.msg.attachment.mime} />
                                    </audio>
                                {:else if message.attachmentType === AttachmentType.File}
                                    <span on:click={downloadURL(attachmentURL(attachmentsURL, message))} class="chunk-download-file panel-glass">
                                        <Icon icon={download} size="24" />
                                        {message.msg.attachment.name}
                                    </span>
                                {/if}
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
        {/if}
    {/each}
</div>
