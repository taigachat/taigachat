import { Device } from "mediasoup-client";
import type { Consumer, MediaKind, Producer, Transport } from "mediasoup-client/lib/types";
import type { VoiceConfig, AudioLevels, MediaDeviceInfoJSON } from "./voice_config";
import type { MessageToSFU, MessageFromSFU, ActiveChannel } from "./schema";
import type { Immutable } from "./immutable";
import { registerDebugCommand } from "./debug_mode";

const peerToProducers: Map<number, string[]> = new Map();

let mediaElementsParent: HTMLElement | undefined = undefined;
const remoteProducerToElement: Map<string, HTMLMediaElement> = new Map();

let currentServerID = "";
let currentChannelID = -1;

let errandNumber = 0;
let createProducerTransportErrand = ++errandNumber;
let createConsumerTransportErrand = ++errandNumber;

let producingBasicAudio = false;
let producerTransport: Transport | undefined = undefined;
let consumerTransport: Transport | undefined = undefined;

let localTracks: MediaStreamTrack[] = [];

enum UnspecificMedia {
    SCREEN = 1,
    AUDIO = 2,
    VIDEO = 3,
}
const typeToProducerID: Map<UnspecificMedia, string> = new Map();

interface ConnectCallback {
    connect: () => void;
    err: (e: Error) => void;
}
const connectCallbacks: Map<number, ConnectCallback> = new Map();

interface ProduceCallback {
    produce: (i: { id: string }) => void;
    err: (e: Error) => void;
}
const produceCallbacks: Map<number, ProduceCallback> = new Map();

function noNewMediaCallback() {
    throw "no channel selected";
}
let newMediaCallback = noNewMediaCallback;

function noTalkingStateCallback(_talking: boolean) {
    throw "no channel selected";
}
let talkingStateCallback = noTalkingStateCallback;

async function noMessageToSFU(_m: MessageToSFU) {
    throw "no channel selected";
}
let messageToSFU = noMessageToSFU;
let mediasoupDevice: Device | undefined = undefined;

// Audio detection stuff.
let inputAudioContext: AudioContext | undefined = undefined;
let mediaStreamAudioSourceNode: MediaStreamAudioSourceNode | undefined = undefined;
let audioDetector: AudioWorkletNode | undefined = undefined;

const consumers: Map<string, Consumer> = new Map();
const producers: Map<string, Producer> = new Map();

function associateProducerWithPeer(peerID: number, producerID: string) {
    let peer = peerToProducers.get(peerID);
    if (peer === undefined) {
        peer = [];
        peerToProducers.set(peerID, peer);
    }
    peer.push(producerID);
}

export function setActiveChannel(
    serverID: string,
    channelID: number,
    message: (m: MessageToSFU) => Promise<void>,
    newNewMediaCallback: () => void,
    newTalkingStateCallback: (talking: boolean) => void
) {
    leaveActiveChannel();
    if (serverID === "") {
        return;
    }
    if (channelID === currentChannelID) {
        console.warn("attempting to connect to the same channel:", currentChannelID);
    }
    try {
        const newMediaElements = document.getElementById("media-elements");
        mediaElementsParent = newMediaElements || undefined;

        mediasoupDevice = new Device();
        currentServerID = serverID;
        currentChannelID = channelID;
        messageToSFU = message;
        newMediaCallback = newNewMediaCallback;
        talkingStateCallback = newTalkingStateCallback;
        inputAudioContext = new AudioContext();
    } catch (error) {
        // TODO: If only we knew the type we could do a simple instanceof here instead. Too bad man is lazy.
        if (
            typeof error === "object" &&
            error !== null &&
            "name" in error &&
            error.name === "UnsupportedError"
        ) {
            console.error("MediaSoup does not support this browser");
            console.error(error);
            alert("Voice calls are not supported by this browser!");
        }
        throw error;
    }
}

function deleteMediaElement(elem: HTMLMediaElement) {
    const srcObject = elem.srcObject;
    if (srcObject && srcObject instanceof MediaStream) {
        for (const track of srcObject.getTracks()) {
            track.stop();
        }
    }
    elem.srcObject = null;
    if (mediaElementsParent) {
        mediaElementsParent.removeChild(elem);
    }
}

function leaveActiveChannel() {
    // Make sure we stop sending first of all.
    for (const track of localTracks) {
        track.enabled = false;
    }
    localTracks = [];

    if (producerTransport) {
        producerTransport.close();
    }
    producerTransport = undefined;
    producingBasicAudio = false;

    if (consumerTransport) {
        consumerTransport.close();
    }
    consumerTransport = undefined;

    // Now that our own privacy is safe, we may remove media elements.
    for (const mediaElement of remoteProducerToElement.values()) {
        deleteMediaElement(mediaElement);
    }
    remoteProducerToElement.clear();

    consumers.clear();
    producers.clear();
    peerToProducers.clear();
    createProducerTransportErrand = ++errandNumber;
    createConsumerTransportErrand = ++errandNumber;
    typeToProducerID.clear();
    connectCallbacks.clear();
    produceCallbacks.clear();
    mediasoupDevice = undefined; // TODO: Perhaps this can be optimized away in some situations?
    messageToSFU = noMessageToSFU;
    newMediaCallback = noNewMediaCallback;
    talkingStateCallback = noTalkingStateCallback;

    currentServerID = "";
    currentChannelID = -1;

    if (audioDetector !== undefined) {
        audioDetector.port.removeEventListener("message", audioDetectorMessage);
        audioDetector.port.close();
        audioDetector.disconnect();
        audioDetector = undefined;
    }
    if (mediaStreamAudioSourceNode !== undefined) {
        mediaStreamAudioSourceNode.disconnect();
        mediaStreamAudioSourceNode = undefined;
    }
    if (inputAudioContext) {
        if (inputAudioContext.state !== "closed") {
            inputAudioContext.close();
        }
        inputAudioContext = undefined;
    }
}

function initProducerTransport(transport: Transport) {
    console.warn("initProducerTransport:", transport.id);
    producerTransport = transport;

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
        const errand = ++errandNumber;
        connectCallbacks.set(errand, {
            connect: callback,
            err: errback, // TODO: Actually call somewhere
        });
        messageToSFU({
            connectTransport: {
                dtlsParameters,
                transportID: transport.id,
                errand,
            },
        });
    });

    transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
        const errand = ++errandNumber;
        produceCallbacks.set(errand, {
            produce: callback,
            err: errback, // TODO: Actually call somewhere?
        });
        messageToSFU({
            produceTransport: {
                producerTransportID: transport.id,
                kind,
                rtpParameters,
                errand,
            },
        });
    });

    transport.on("connectionstatechange", (state) => {
        switch (state) {
            case "connecting":
                break;
            case "connected":
                break;
            case "failed":
                transport.close();
                break;
            default:
                break;
        }
    });
}

function initConsumerTransport(transport: Transport) {
    console.warn("initConsumerTransport:", transport.id);
    consumerTransport = transport;

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
        const errand = ++errandNumber;
        connectCallbacks.set(errand, {
            connect: callback,
            err: errback, // TODO: Actually call somewhere
        });
        messageToSFU({
            connectTransport: {
                dtlsParameters,
                transportID: transport.id,
                errand,
            },
        });
    });

    transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
        const errand = ++errandNumber;
        produceCallbacks.set(errand, {
            produce: callback,
            err: errback, // TODO: Actually call somewhere?
        });
        messageToSFU({
            produceTransport: {
                producerTransportID: transport.id,
                kind,
                rtpParameters,
                errand,
            },
        });
    });

    transport.on("connectionstatechange", (state) => {
        switch (state) {
            case "connecting":
                break;
            case "connected":
                break;
            case "failed":
                transport.close();
                break;
            default:
                break;
        }
    });
}

function removeConsumer(id: string) {
    const elem = remoteProducerToElement.get(id);
    if (elem !== undefined) {
        deleteMediaElement(elem);
    }
    consumers.delete(id);
    remoteProducerToElement.delete(id);
}

async function producerConsumed(consumer: Consumer, kind: MediaKind, stream: MediaStream) {
    consumers.set(consumer.id, consumer);

    if (kind === "video") {
        const elem = document.createElement("video");
        elem.srcObject = stream;
        elem.id = consumer.id;
        elem.playsInline = false;
        elem.autoplay = true;
        if (mediaElementsParent) {
            mediaElementsParent.appendChild(elem);
        }
        remoteProducerToElement.set(consumer.producerId, elem);
        // TODO: Handle fullscreen somewhere
    } else {
        const elem = document.createElement("audio");
        elem.srcObject = stream;
        elem.id = consumer.id;

        // The volume will be readjusted later to the correct value
        // by the newMediaCallback() call.
        elem.volume = 0;
        (elem as unknown as { playsInline: boolean }).playsInline = false; // TODO: Remove?
        elem.autoplay = true;
        if (mediaElementsParent) {
            mediaElementsParent.appendChild(elem);
        }
        remoteProducerToElement.set(consumer.producerId, elem);
    }

    consumer.on("trackended", function () {
        removeConsumer(consumer.id);
    });

    consumer.on("transportclose", function () {
        removeConsumer(consumer.id);
    });

    newMediaCallback();
}

function closeProducer(type: UnspecificMedia) {
    const producerID = typeToProducerID.get(type);
    if (producerID === undefined) {
        console.log("there is no producer for this type " + type);
        return;
    }
    console.log("close producer", producerID);

    messageToSFU({
        producerClosed: {
            producerID,
        },
    });

    const producer = producers.get(producerID);
    if (!producer) {
        console.log(`producer of ID ${producerID} could not be found`);
        return;
    }
    producer.close();

    producers.delete(producerID);
    typeToProducerID.delete(type);

    if (type === UnspecificMedia.VIDEO || type === UnspecificMedia.SCREEN) {
        const elem = document.getElementById(producerID);
        if (elem instanceof HTMLMediaElement && elem.srcObject instanceof MediaStream && elem.parentNode) {
            elem.srcObject.getTracks().forEach(function (track) {
                track.stop();
            });
            elem.parentNode.removeChild(elem);
        }
    }
}

function audioDetectorMessage(event: MessageEvent<{ clipping: boolean }>) {
    talkingStateCallback(event.data.clipping);
}

async function setupAudioDetection(userMedia: MediaStream) {
    if (inputAudioContext && inputAudioContext.state === "running") {
        await inputAudioContext.audioWorklet.addModule("./static/audio-detector.js");
    }

    if (inputAudioContext && inputAudioContext.state === "running") {
        mediaStreamAudioSourceNode = inputAudioContext.createMediaStreamSource(userMedia);
        audioDetector = new AudioWorkletNode(inputAudioContext, "audio-detector-processor");
        audioDetector.port.addEventListener("message", audioDetectorMessage);
        audioDetector.port.start();
        mediaStreamAudioSourceNode.connect(audioDetector);
    }
}

async function produceMedia(device: MediaDeviceInfoJSON | UnspecificMedia) {
    console.warn(device);
    if (mediasoupDevice === undefined) {
        console.error("produceMeda() called before mediasoupDevice initialized");
        return;
    }
    if (device === undefined) {
        console.error("produceMedia() called without device parameter");
        return;
    }

    const videoConstraints = {
        width: {
            min: 640,
            ideal: 1920,
        },
        height: {
            min: 400,
            ideal: 1080,
        },
        /*aspectRatio: {
            ideal: 1.7777777778
        }*/
    };

    const type =
        typeof device === "number"
            ? device
            : device.kind === "videoinput"
              ? UnspecificMedia.VIDEO
              : UnspecificMedia.AUDIO;

    const producesVideo = type == UnspecificMedia.VIDEO || type == UnspecificMedia.SCREEN;

    if (!mediasoupDevice.canProduce("video") && producesVideo) {
        console.error("this device does not support video in calls");
        return;
    }

    const stream =
        device === UnspecificMedia.SCREEN
            ? await navigator.mediaDevices.getDisplayMedia()
            : device === UnspecificMedia.AUDIO
              ? await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: false,
                })
              : device === UnspecificMedia.VIDEO
                ? await navigator.mediaDevices.getUserMedia({
                      audio: false,
                      video: videoConstraints,
                  })
                : await navigator.mediaDevices.getUserMedia({
                      audio:
                          device.kind === "audioinput"
                              ? {
                                    deviceId: device.deviceId,
                                    groupId: device.groupId,
                                }
                              : false,
                      video:
                          device.kind === "videoinput"
                              ? {
                                    ...videoConstraints,
                                    deviceId: device.deviceId,
                                    groupId: device.groupId,
                                }
                              : false,
                  });
    const track = producesVideo ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
    if (track === undefined) {
        console.error("could not find track in MediaStream");
        return;
    }
    localTracks.push(track);

    if (typeToProducerID.has(type)) {
        console.error(`producer of type ${type} already exists`);
        return;
    }
    try {
        console.log(navigator.mediaDevices.getSupportedConstraints());
        if (producerTransport === undefined) {
            console.error("produceMedia() called before producerTransport initialized");
            return;
        }
        const producer = await producerTransport.produce({
            track,
            encodings:
                type === UnspecificMedia.VIDEO
                    ? [
                          {
                              rid: "r0",
                              maxBitrate: 100000,
                              //scaleResolutionDownBy: 10.0,
                              scalabilityMode: "S1T3",
                          },
                          {
                              rid: "r1",
                              maxBitrate: 300000,
                              scalabilityMode: "S1T3",
                          },
                          {
                              rid: "r2",
                              maxBitrate: 900000,
                              scalabilityMode: "S1T3",
                          },
                      ]
                    : undefined,
            codecOptions:
                type === UnspecificMedia.VIDEO
                    ? {
                          videoGoogleStartBitrate: 1000,
                      }
                    : undefined,
        });
        console.log("Producer", producer);

        producers.set(producer.id, producer);

        let elem: HTMLVideoElement | undefined = undefined;
        if (producesVideo) {
            elem = document.createElement("video");
            elem.srcObject = stream;
            elem.id = producer.id;
            elem.playsInline = false;
            elem.autoplay = true;
            elem.className = "vid";
            if (mediaElementsParent) {
                mediaElementsParent.appendChild(elem);
            }
            // TODO: Handle fullscreen somewhere
            // TODO: Should we add to mediaElements?
        }

        producer.on("trackended", () => {
            closeProducer(type);
        });

        producer.on("transportclose", () => {
            console.log("Producer transport close");
            if (elem && elem.srcObject instanceof MediaStream && elem.parentNode) {
                elem.srcObject.getTracks().forEach(function (track) {
                    track.stop();
                });
                elem.parentNode.removeChild(elem);
            }
            producers.delete(producer.id);
        });

        producer.on("@close", () => {
            console.log("Closing producer");
            if (elem && elem.srcObject instanceof MediaStream && elem.parentNode) {
                elem.srcObject.getTracks().forEach(function (track) {
                    track.stop();
                });
                elem.parentNode.removeChild(elem);
            }
            producers.delete(producer.id);
        });

        typeToProducerID.set(type, producer.id);
    } catch (err) {
        console.log("Produce error:", err);
    }

    await setupAudioDetection(stream);
}

registerDebugCommand("produceMedia", produceMedia);

export async function handleSFUMessage(serverID: string, message: MessageFromSFU) {
    console.log("serverID", serverID, "sent message", message);
    if (serverID !== currentServerID || !mediasoupDevice) {
        return;
    } else if (message.capabilities) {
        await mediasoupDevice.load({
            routerRtpCapabilities: message.capabilities,
        });

        messageToSFU({
            createTransport: {
                forceTCP: false,
                rtpCapabilities: mediasoupDevice.rtpCapabilities,
                errand: createProducerTransportErrand,
            },
        });

        messageToSFU({
            createTransport: {
                forceTCP: false,
                rtpCapabilities: mediasoupDevice.rtpCapabilities,
                errand: createConsumerTransportErrand,
            },
        });
    } else if (message.transportCreated) {
        const n = message.transportCreated;
        if (n.errand === createProducerTransportErrand) {
            initProducerTransport(mediasoupDevice.createSendTransport(n.data));

            // We activate the callback such that we may select
            // what audio device to use inside of updateCallVolumes()
            newMediaCallback();
        } else if (n.errand === createConsumerTransportErrand) {
            initConsumerTransport(mediasoupDevice.createRecvTransport(n.data));
        }
        if (producerTransport !== undefined && consumerTransport !== undefined) {
            messageToSFU({ getProducers: {} });
        }
    } else if (message.transportConnected) {
        const cb = connectCallbacks.get(message.transportConnected.errand);
        if (cb) {
            cb.connect();
        }
    } else if (message.transportProducing) {
        const cb = produceCallbacks.get(message.transportProducing.errand);
        if (cb) {
            cb.produce({ id: message.transportProducing.producerID });
        }
    } else if (message.newProducers) {
        if (consumerTransport === undefined) {
            console.error("consumerTransport not created yet!");
            return;
        }
        for (const producer of message.newProducers) {
            messageToSFU({
                consumeProducer: {
                    rtpCapabilities: mediasoupDevice.rtpCapabilities,
                    consumerTransportID: consumerTransport.id,
                    producerID: producer.producerID,
                },
            });
            associateProducerWithPeer(producer.peerID, producer.producerID);
        }
    }

    if (message.producerConsumed) {
        if (consumerTransport === undefined) {
            console.error("consumerTransport not created yet!");
            return;
        }
        const { id, producerID, kind, rtpParameters } = message.producerConsumed;

        const consumer = await consumerTransport.consume({
            id,
            producerId: producerID,
            kind,
            rtpParameters,
            //codecOptions: {} // Codec Options
        });

        const stream = new MediaStream();
        stream.addTrack(consumer.track);

        producerConsumed(consumer, kind, stream);
    }
}

export async function updateCallVolumes(
    voice: VoiceConfig,
    activeChannel: Immutable<ActiveChannel>,
    audioLevels: AudioLevels,
    pushToTalk: boolean
) {
    if (producerTransport !== undefined && !producingBasicAudio) {
        producingBasicAudio = true;
        await produceMedia(voice.inputAudioDevice || UnspecificMedia.AUDIO);
        // TODO: The above await call is the only reason this function is async...
        // TODO: Ugly recursive call. newMediaCallback() => updateCallVolumes()
        newMediaCallback();
        return;
    }

    const userVolumes: Map<number, number> = new Map();
    const producerVolumes: Map<string, number> = new Map();
    for (const user of activeChannel.connectedUsers) {
        // TODO: use authID instead for the users.
        let audioLevel = audioLevels[user.userID];
        if (audioLevel === undefined) {
            audioLevel = 100;
        }
        if (user.selfMute) {
            audioLevel = 0;
        }
        userVolumes.set(user.peerID, audioLevel);
    }
    for (const producerID of remoteProducerToElement.keys()) {
        producerVolumes.set(producerID, 0);
    }
    if (!voice.selfDeafen) {
        // Go from default 0 to the correct volume for each producer.
        for (const [peerID, producers] of peerToProducers.entries()) {
            const userVolume = userVolumes.get(peerID) || 0;
            for (const producer of producers) {
                producerVolumes.set(producer, userVolume);
            }
        }
    }
    for (const [producerID, volume] of producerVolumes.entries()) {
        const elements = remoteProducerToElement.get(producerID);
        if (elements !== undefined) {
            elements.volume = Math.min(1, Math.max(0, volume / 100));
        }
    }

    for (const track of localTracks) {
        track.enabled = !voice.selfMute && (!pushToTalk || voice.pushToTalkPressed);
    }

    //console.log('updateCallVolumes called!', userVolumes, producerVolumes, producerToElement, audioLevels)
}
