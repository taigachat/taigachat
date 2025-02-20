export interface MediaDeviceInfoJSON {
    readonly deviceId: string;
    readonly groupId: string;
    readonly kind: MediaDeviceKind;
    readonly label: string;
}

export const defaultVoiceConfig = {
    activeServerID: "",
    activeChannelID: -1,
    selfMute: false,
    selfDeafen: false,
    inputAudioDevice: undefined as MediaDeviceInfoJSON | undefined,
    noiseSuppression: true,
    selfVideo: false,
    pushToTalkPressed: false, // TODO: Currently, voice is saved each time push to talk is pushed (and activeServerID changes), this is bad
    // TODO: Instead we should have a persistent subpart.
};

export type VoiceConfig = typeof defaultVoiceConfig;

export type AudioLevels = Record<string, number>;
