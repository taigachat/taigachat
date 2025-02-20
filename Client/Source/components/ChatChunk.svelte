<script lang="ts">
import type { Immutable } from "../immutable";
import Icon from "./Icon.svelte";
import MessageEditor from "./MessageEditor.svelte";
import { edit, remove, download } from "../icons";
import {
    FLAG_BOLD,
    FLAG_ITALIC,
    FLAG_STRIKE,
    FLAG_UNDERLINE,
    FLAG_NEWLINE,
    FLAG_LINK,
    parseMessage,
} from "../message_format";
import { setServerRoomEditingMessage, setMediaVolume } from "../store";
import { MessageVisibility, AttachmentType } from "../message_format";
import type { ParsedMessage, ParsedMessageNormal } from "../message_format";
import type { TextRoom, MainStore } from "../store";
import { setPopup } from "../routes";
import { onServer } from "../actions";
import { currentDefaultMediaVolume } from "../acts";
import { openURL } from "../sal";
import { getServerProfile } from "../profiles";
import type { Message, ServerUser } from "../schema";
import type { EventHandler } from "svelte/elements";

import { decryptChunk, endToEndEncryptMessage } from "../e2e_manager";

interface ChatChunkProps {
    chunkGrowCallback: (chunkID: number) => void;
    unparsedMessages: Immutable<Message[]>;
    room: Immutable<TextRoom>;
    roomID: number;
    chunkID: number;
    serverID: string;
    users: Immutable<Record<string, ServerUser>>;
    reportedChunkHeight: number | undefined;
    roomMeta: { messageEditing: string };
    currentUserID: string;
    attachmentsURL: (fileName: string) => URL;
    profilesModified: number;
    endToEndEncryptionKeys: Immutable<MainStore["endToEndEncryptionKeys"]>;
    messageTimeFormat: string;
}

let {
    chunkGrowCallback,
    unparsedMessages,
    room,
    roomID,
    chunkID,
    serverID,
    users,
    reportedChunkHeight = $bindable(),
    roomMeta,
    currentUserID,
    attachmentsURL,
    profilesModified,
    endToEndEncryptionKeys,
    messageTimeFormat,
}: ChatChunkProps = $props();

let lastRoomID: number;
let lastChunkID: number;
let lastMessageCount: number;

let chunkContainer: HTMLDivElement;

let decryptionCacheKey: Immutable<Message>[] = [];
let decryptionCacheValue: Immutable<ParsedMessage>[] = [];
let currentDecryptedMessages: Immutable<ParsedMessage>[] = [];

let decryptedMessages = $state([] as Immutable<ParsedMessage>[]);

function withDecryptionCache(
    unparsed: Immutable<Message[]>,
    endToEndEncryptionKeys: Immutable<MainStore["endToEndEncryptionKeys"]>,
    messageTimeFormat: string
) {
    const result: Immutable<ParsedMessage>[] = [];
    currentDecryptedMessages = result;

    for (let i = 0; i < unparsed.length; i++) {
        if (unparsed[i] !== decryptionCacheKey[i]) {
            const visibility = unparsed[i]!.encryptedBy
                ? MessageVisibility.DECRYPTION_PENDING
                : MessageVisibility.VISIBLE;
            const parsed = parseMessage(unparsed[i]!, visibility, messageTimeFormat);
            decryptionCacheKey[i] = unparsed[i]!;
            decryptionCacheValue[i] = parsed;
        }
        result[i] = decryptionCacheValue[i];
    }
    decryptedMessages = result;
    decryptChunk(
        result,
        endToEndEncryptionKeys,
        (newMessage, oldMessage, i) => {
            if (result !== currentDecryptedMessages) {
                // Belongs to some other execution.
                return false;
            }

            decryptionCacheKey[i] = oldMessage;
            decryptionCacheValue[i] = newMessage;

            // Trigger a rerender.
            decryptedMessages[i] = newMessage;
            return true;
        },
        messageTimeFormat
    );
    return result;
}

let previousParsedMessages: Immutable<Message[]> = [];
let previousEndToEndEncryptionKeys = {};

$effect.pre(() => {
    if (
        previousParsedMessages !== unparsedMessages ||
        previousEndToEndEncryptionKeys !== endToEndEncryptionKeys
    ) {
        previousParsedMessages = unparsedMessages;
        previousEndToEndEncryptionKeys = endToEndEncryptionKeys;
        withDecryptionCache(unparsedMessages, endToEndEncryptionKeys, messageTimeFormat);
    }
});

function attachmentURL(attachmentsURL: (fileName: string) => URL, message: Immutable<ParsedMessageNormal>) {
    if (!message.msg.attachment) {
        console.error("attachmentURL called on message without attachment");
        return "";
    }
    return attachmentsURL(message.msg.attachment.fileName).href;
}

function bindClickUser(i: number) {
    return () => {
        const parsedMessage = decryptedMessages[i];
        if (parsedMessage !== undefined) {
            setPopup({
                viewUser: {
                    userID: parsedMessage.msg.userID,
                    serverID,
                },
            });
        } else {
            console.warn("clicking this profile should not be possible");
        }
    };
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
        });
    };
}
function bindStartEditing(i: number) {
    return () => {
        const parsedMessage = decryptedMessages[i];
        if (parsedMessage) {
            roomMeta.messageEditing = parsedMessage.msg.content || "";
            setServerRoomEditingMessage(serverID, roomID, chunkID, i);
        }
    };
}

function bindViewImage(i: number) {
    return () => {
        const parsedMessage = decryptedMessages[i];
        if (parsedMessage !== undefined) {
            setPopup({ viewImage: attachmentURL(attachmentsURL, parsedMessage) });
        }
    };
}

function handleUpdate() {
    if (reportedChunkHeight != chunkContainer.scrollHeight) {
        reportedChunkHeight = chunkContainer.scrollHeight;
    }
    const contentIncreased = decryptedMessages.length > lastMessageCount;
    //console.log('handleUpdate', chunkID, height, contentIncreased)
    if (reportedChunkHeight !== 0 && contentIncreased) {
        //console.log('chunk grown: ', chunkID)
        chunkGrowCallback(chunkID);
        lastMessageCount = decryptedMessages.length;
    }
}

async function cancelEditing() {
    await setServerRoomEditingMessage(serverID, roomID, -1, -1);
    roomMeta.messageEditing = "";
}

function bindFinishEditing(i: number) {
    return async () => {
        // TODO: Schedule it into the message_sender instead.
        const parsedMessage = decryptionCacheValue[i];
        if (!parsedMessage) {
            return;
        }

        let content = roomMeta.messageEditing;

        if (parsedMessage.msg.encryptedBy) {
            const encryptedBy = endToEndEncryptionKeys[parsedMessage.msg.encryptedBy];
            if (encryptedBy) {
                content = await endToEndEncryptMessage(encryptedBy, content);
            } else {
                // TODO: report the missing key
                return;
            }
        }
        await onServer.editMessage0(serverID, roomID, chunkID, i, content);
        cancelEditing();
    };
}

function changeEditing(m: string) {
    roomMeta.messageEditing = m;
}

$effect.pre(() => {
    if (roomID !== lastRoomID || chunkID !== lastChunkID) {
        lastMessageCount = 0;
        lastRoomID = roomID;
        lastChunkID = chunkID;
        reportedChunkHeight = 0;
    }
});

$effect(handleUpdate);

// TODO: Investigate if this code is still needed on some platforms:
/*
function handleURL(url: string) {
    return (e: MouseEvent) => {
        e.preventDefault()
        openURL(url)
        return false
    }
}
*/

function downloadURL(url: string) {
    return (e: MouseEvent) => {
        e.preventDefault();
        openURL(url);
        return false;
    };
}

function* getMessagesWithProfiles(
    serverID: string,
    messages: Immutable<ParsedMessage[]>,
    _profilesModified: number
) {
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message === undefined) {
            continue;
        }
        const user = users[message.msg.userID];
        const confirmedProfile = getServerProfile(serverID, message.msg.userID, user);

        yield { message, confirmedProfile, i };
    }
}

const mediaVolumeChanged: EventHandler<Event, HTMLMediaElement> = (event) => {
    setMediaVolume(event.currentTarget.volume);
};

const mediaPlaying: EventHandler<Event, HTMLMediaElement> = (event) => {
    event.currentTarget.volume = currentDefaultMediaVolume;
};
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
    font-variation-settings: "wght" 600;
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
    {#each getMessagesWithProfiles(serverID, decryptedMessages, profilesModified) as { message, confirmedProfile, i }}
        {@const deleteMessage = bindDeleteMessage(i)}
        {@const startEditing = bindStartEditing(i)}
        {@const clickUser = bindClickUser(i)}
        {@const finishEditing = bindFinishEditing(i)}
        {@const viewImage = bindViewImage(i)}
        {#if message !== undefined}
            <div class="chunk-message-container">
                <div class="chunk-message-options">
                    <!-- TODO: Should we check for permissions? -->
                    <button onclick={deleteMessage}><Icon icon={remove} size="24" /></button>
                    {#if message.msg.userID === currentUserID}
                        <!-- TODO: Do we do a more advanced check in the future? -->
                        <button onclick={startEditing}><Icon icon={edit} size="24" /></button>
                    {/if}
                </div>

                <!-- TODO: Round the corners if the image is big enough. -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <img
                    loading="lazy"
                    alt="avatar of {confirmedProfile.displayedName}"
                    class="chunk-avatar"
                    src={confirmedProfile.displayedAvatar}
                    onload={confirmedProfile.load}
                    onclick={clickUser} />

                <div class="chunk-message">
                    {#if chunkID === room.editingMessageChunkID && i === room.editingMessageIndex}
                        <div class="chunk-username">
                            {confirmedProfile.displayedName}
                            - (editing)
                        </div>
                        <MessageEditor
                            value={roomMeta.messageEditing}
                            oncancel={cancelEditing}
                            onchange={changeEditing}
                            onpublish={finishEditing} />
                    {:else}
                        <div class="chunk-username">
                            {confirmedProfile.displayedName}
                            -
                            {message.time}{message.msg.edited ? " (edited)" : ""}
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
                                    <a class="chunk-link" href={component.text}>{component.text}</a>
                                {:else}
                                    {component.text}
                                {/if}
                            </span>
                        {/each}

                        {#if message.attachmentType !== AttachmentType.None}
                            {@const attachment = message.msg.attachment}
                            <div class="chunk-attachment">
                                {#if message.attachmentType === AttachmentType.Loading || !attachment}
                                    <span> Now Loading! </span>
                                {:else if message.attachmentType === AttachmentType.Image}
                                    <button
                                        onclick={viewImage}
                                        style="height: {Math.min(attachment.height || 0, 282)}px;">
                                        <img
                                            alt="attachment"
                                            loading="lazy"
                                            class="chunk-attachment-image"
                                            src={attachmentURL(attachmentsURL, message)} />
                                    </button>
                                {:else if message.attachmentType === AttachmentType.Video}
                                    <!-- TODO: Does the browser always load the file directly? If, so that is probably bad... -->
                                    <video
                                        onplaying={mediaPlaying}
                                        onvolumechange={mediaVolumeChanged}
                                        width="400"
                                        height="224"
                                        controls>
                                        <source
                                            src={attachmentURL(attachmentsURL, message)}
                                            type={message.msg.attachment.mime} />
                                        <track kind="captions" />
                                    </video>
                                {:else if message.attachmentType === AttachmentType.Audio}
                                    <audio
                                        onplaying={mediaPlaying}
                                        onvolumechange={mediaVolumeChanged}
                                        controls>
                                        <source
                                            src={attachmentURL(attachmentsURL, message)}
                                            type={message.msg.attachment.mime} />
                                    </audio>
                                {:else if message.attachmentType === AttachmentType.File}
                                    <button
                                        onclick={downloadURL(attachmentURL(attachmentsURL, message))}
                                        class="chunk-download-file panel-glass">
                                        <Icon icon={download} size="24" />
                                        {message.msg.attachment.name}
                                    </button>
                                {/if}
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
        {/if}
    {/each}
</div>
