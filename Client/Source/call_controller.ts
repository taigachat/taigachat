import { setActiveChannel, updateCallVolumes } from "./call";
import { onServer } from "./actions";
import { playSound } from "./sounds";
import type { Immutable } from "./immutable";
import type { AudioLevels, VoiceConfig } from "./voice_config";
import type { MainStore } from "./store";
import type { ActiveChannel } from "./schema";

let currentServerID = "";
let currentChannelID = -1;
let previousActiveVoiceChannel: Immutable<ActiveChannel> | undefined = undefined;
let previousAudioLevels: Immutable<AudioLevels> | undefined = undefined;
let previousVoice: Immutable<VoiceConfig> | undefined = undefined;
let pushToTalk = false;
let lastTalking = false;

function callUpdateCallVolumes() {
    if (
        previousVoice === undefined ||
        previousActiveVoiceChannel === undefined ||
        previousAudioLevels === undefined
    ) {
        return;
    }
    updateCallVolumes(previousVoice, previousActiveVoiceChannel, previousAudioLevels, pushToTalk);
}

function talkingStateChanged(talking: boolean) {
    if (talking === lastTalking) {
        return;
    }
    lastTalking = talking;
    if (
        previousVoice &&
        (previousVoice.selfMute || (pushToTalk && !previousVoice.pushToTalkPressed && talking))
    ) {
        return;
    }
    onServer.setVoiceTalking0(currentServerID, talking);
}

function playJoinOrLeaveSound(
    old: Immutable<ActiveChannel> | undefined,
    newChannel: Immutable<ActiveChannel>
) {
    if (old === undefined) {
        return;
    }
    const userDifference = newChannel.connectedUsers.length - old.connectedUsers.length;
    if (userDifference > 0) {
        playSound("userJoin");
    } else if (userDifference < 0) {
        playSound("userLeave");
    }
}

export function handleStoreChanged(s: Immutable<MainStore>) {
    let needsVolumeChange = false;
    pushToTalk = s.miscConfig.pushToTalk;

    if (previousVoice !== s.voice) {
        if (previousVoice) {
            if (previousVoice.selfMute !== s.voice.selfMute) {
                onServer.setVoiceMute0(currentServerID, s.voice.selfMute, lastTalking);
            }
            if (previousVoice.selfDeafen !== s.voice.selfDeafen) {
                onServer.setVoiceDeafen0(currentServerID, s.voice.selfDeafen);
            }
        }

        // Gracefully disconnect from the previous server.
        if (currentServerID !== s.voice.activeServerID && currentServerID !== "") {
            onServer.joinChannel0(currentServerID, -1, true, true);
            playSound("userLeave");
        }

        previousVoice = s.voice;
        if (currentServerID !== s.voice.activeServerID || currentChannelID !== s.voice.activeChannelID) {
            currentServerID = s.voice.activeServerID;
            currentChannelID = s.voice.activeChannelID;
            const serverID = currentServerID;
            setActiveChannel(
                serverID,
                currentChannelID,
                async (m) => {
                    onServer.sendMessageSFU0(serverID, m);
                },
                callUpdateCallVolumes,
                talkingStateChanged
            );
            onServer.joinChannel0(serverID, currentChannelID, s.voice.selfMute, s.voice.selfDeafen);
            previousActiveVoiceChannel = undefined;
        }
        needsVolumeChange = true;
    }

    if (currentServerID === "" || currentChannelID === -1) {
        return;
    }

    const server = s.servers[currentServerID];
    if (server === undefined) {
        return;
    }

    const activeChannel = server.activeChannels[currentChannelID];
    if (activeChannel === undefined) {
        return;
    }

    if (activeChannel !== previousActiveVoiceChannel) {
        playJoinOrLeaveSound(previousActiveVoiceChannel, activeChannel);
        previousActiveVoiceChannel = activeChannel;
        needsVolumeChange = true;
    }

    if (previousAudioLevels !== s.audioLevels) {
        previousAudioLevels = s.audioLevels;
        needsVolumeChange = true;
    }

    if (needsVolumeChange) {
        callUpdateCallVolumes();
    }
}
