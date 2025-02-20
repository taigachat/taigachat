use mediasoup::prelude::*;
use mediasoup::worker::{WorkerLogLevel, WorkerLogTag};
use futures_util::SinkExt;
use log::error;

// perhaps use https://crates.io/crates/fastwebsockets instead?

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use anyhow::{bail, Result};
use tokio::sync::mpsc::UnboundedSender;

type PeerID = usize;

#[derive(Serialize, Deserialize, Debug)]
struct NewProducer {
    #[serde(rename = "peerID")]
    peer_id: PeerID,

    #[serde(rename = "producerID")]
    producer_id: String,
}

struct Peer {
    deaf: bool,
    transports: HashMap<String, WebRtcTransport>,
    producers: HashMap<String, Producer>,
    consumers: HashMap<String, Consumer>,
}

struct Channel {
    channel_id: usize,
    router: Router,
    peers: HashMap<PeerID, Peer>,

    listen_ip: std::net::IpAddr,
    announce_ip: std::net::IpAddr,
}

impl Channel {
    fn get_producers(&self) -> Vec<NewProducer> {
        let mut results = vec![];
        for (peer_id, peer) in &self.peers {
            for producer_id in peer.producers.keys() {
                results.push(NewProducer {
                    peer_id: *peer_id,
                    producer_id: producer_id.clone()
                });
            }
        }
        results
    }
}

struct State {
    worker: Worker,
    channels: HashMap<usize, Channel>,

    listen_ip: std::net::IpAddr,
    announce_ip: std::net::IpAddr,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
enum FromClient {
    CreateTransport {
        #[serde(rename = "rtpCapabilities")]
        rtp_capabilities: RtpCapabilities,

        #[serde(rename = "forceTCP")]
        force_tcp: bool,

        errand: usize,
    },
    ConnectTransport {
        #[serde(rename = "dtlsParameters")]
        dtls_parameters: DtlsParameters,

        #[serde(rename = "transportID")]
        transport_id: String,

        errand: usize,
    },
    ProduceTransport {
        #[serde(rename = "producerTransportID")]
        producer_transport_id: String,

        kind: MediaKind,

        #[serde(rename = "rtpParameters")]
        rtp_parameters: RtpParameters,

        errand: usize,
    },
    ProducerClosed {
        #[serde(rename = "producerID")]
        producer_id: String,
    },
    ConsumeProducer {
        #[serde(rename = "rtpCapabilities")]
        rtp_capabilities: RtpCapabilities,

        #[serde(rename = "consumerTransportID")]
        consumer_transport_id: String,

        #[serde(rename = "producerID")]
        producer_id: ProducerId,
    },
    ConsumerClosed {
        #[serde(rename = "consumerID")]
        consumer_id: String,
    },
    GetProducers {},
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct TransportOptions {
    id: String,
    ice_parameters: IceParameters,
    ice_candidates: Vec<IceCandidate>,
    dtls_parameters: DtlsParameters,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
enum ToClient {
     Capabilities(RtpCapabilitiesFinalized),
     NewProducers(Vec<NewProducer>),
     ConsumerClosed(String),
     TransportCreated {
        errand: usize,
        data: TransportOptions,
     },
     TransportConnected {
        errand: usize,
     },
     TransportProducing {
        errand: usize,

        #[serde(rename = "producerID")]
        producer_id: String,
     },
     ProducerConsumed {
        id: String,

        #[serde(rename = "producerID")]
        producer_id: String,
        kind: MediaKind,

        #[serde(rename = "rtpParameters")]
        rtp_parameters: RtpParameters,
     },
     Nothing,
}


#[derive(Serialize)]
struct ToServer(usize, PeerID, ToClient);


#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum IncomingMessage {
    NewChannel {channel: usize, codecs: Vec<RtpCodecCapability>},
    AddPeer {channel: usize, peer: PeerID},
    RemovePeer {channel: usize, peer: PeerID},
    RemoveTransport {channel: usize, peer: PeerID, transport_id: String},
    HandleClient {channel: usize, peer: PeerID, message: FromClient},
    SetDeafenPeer {channel: usize, peer: PeerID, deafen: bool},

    // Used internally by the SFU.
    BroadCast {channel: usize, from_peer: PeerID, message: ToClient},
    MessageTo {channel: usize, peer: PeerID, message: ToClient},
    Heartbeat,
}

fn allowed_announce_ip(address: std::net::IpAddr) -> bool {
    // Because web browsers will refuse to connect to localhost
    // we refuse to even start a media-worker that announces localhost
    // to be its IP.
    match address {
        std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) => false,
        std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED) => false,
        std::net::IpAddr::V6(std::net::Ipv6Addr::LOCALHOST) => false,
        std::net::IpAddr::V6(std::net::Ipv6Addr::UNSPECIFIED) => false,
        _ => true,
    }
}

async fn process_client_command(channel: &mut Channel, peer_id: PeerID, message: FromClient, tx: &UnboundedSender<IncomingMessage>) -> Result<ToClient> {
    Ok(match message {
        FromClient::CreateTransport{rtp_capabilities, force_tcp, errand} => {
            _ = rtp_capabilities;
            _ = force_tcp; // TODO: Use these
            let Some(peer) = channel.peers.get_mut(&peer_id) else {
                bail!("peer ID not found in channel");
            };

            if !allowed_announce_ip(channel.announce_ip) {
                bail!("announce_ip set to unallowed IP value");
            }

            let transport = channel.router.create_webrtc_transport(WebRtcTransportOptions::new(WebRtcTransportListenInfos::new(
                ListenInfo {
                    protocol: Protocol::Udp,
                    ip: channel.listen_ip,
                    announced_address: Some(channel.announce_ip.to_string()),
                    port: None,
                    port_range: None,
                    flags: None,
                    send_buffer_size: None,
                    recv_buffer_size: None,
                }
            ).insert(
                ListenInfo {
                    protocol: Protocol::Tcp,
                    ip: channel.listen_ip,
                    announced_address: Some(channel.announce_ip.to_string()),
                    port: None,
                    port_range: None,
                    flags: None,
                    send_buffer_size: None,
                    recv_buffer_size: None,                   
                }
            ))).await?;
            let transport_id = transport.id().to_string();
            let result = ToClient::TransportCreated {
                errand,
                data: TransportOptions {
                    id: transport_id.clone(),
                    ice_candidates: transport.ice_candidates().clone(),
                    ice_parameters: transport.ice_parameters().clone(),
                    dtls_parameters: transport.dtls_parameters(),
                }
            };
            let channel_id = channel.channel_id;
            let transport_id = transport.id().to_string();
            let transport_id_2 = transport_id.clone();

            let tx = tx.clone();
            transport.on_dtls_state_change(move |s| {
                println!("transport closed: {:#?}", s);
                match s {
                    mediasoup::data_structures::DtlsState::Closed => {
                        _ = tx.send(IncomingMessage::RemoveTransport {
                            channel: channel_id,
                            peer: peer_id,
                            transport_id: transport_id.clone(),
                        });
                    }
                    _ => {}
                }
            }).detach();
            peer.transports.insert(transport_id_2, transport);
            result
        }
        FromClient::ConnectTransport{dtls_parameters, transport_id, errand} => {
            let Some(peer) = channel.peers.get_mut(&peer_id) else {
                bail!("peer ID not found in channel");
            };
            let Some(transport) = peer.transports.get_mut(&transport_id) else {
                bail!("transport ID not found in peer");
            };
            transport.connect(WebRtcTransportRemoteParameters {
                dtls_parameters
            }).await?;

            ToClient::TransportConnected {
                errand
            }
        }
        FromClient::ProduceTransport{producer_transport_id, kind, rtp_parameters, errand} => {
            let Some(peer) = channel.peers.get_mut(&peer_id) else {
                bail!("peer ID not found in channel");
            };
            let Some(transport) = peer.transports.get_mut(&producer_transport_id) else {
                bail!("transport ID not found in peer");
            };
            let producer = transport.produce(ProducerOptions::new(kind, rtp_parameters)).await?;
            let producer_id = producer.id().to_string();

            let channel_id = channel.channel_id;
            let producer_id_2 = producer_id.clone();
            let tx_2 = tx.clone();
            producer.on_transport_close(move || {
                _ = tx_2.send(IncomingMessage::HandleClient {
                    channel: channel_id,
                    peer: peer_id,
                    message: FromClient::ProducerClosed {
                        producer_id: producer_id_2.clone(),
                    }
                });
            }).detach();
            peer.producers.insert(producer_id.clone(), producer);

            _ = tx.send(IncomingMessage::BroadCast {
                channel: channel.channel_id,
                from_peer: peer_id,
                message: ToClient::NewProducers(vec![NewProducer {
                    peer_id: peer_id,
                    producer_id: producer_id.clone()
                }])
            });


            ToClient::TransportProducing {
                errand,
                producer_id
            }
        }
        FromClient::ProducerClosed{producer_id} => {
            let Some(peer) = channel.peers.get_mut(&peer_id) else {
                bail!("peer ID not found in channel");
            };
            peer.producers.remove(&producer_id);
            ToClient::Nothing
        }
        FromClient::ConsumeProducer{rtp_capabilities, consumer_transport_id, producer_id} => {
            if !channel.router.can_consume(&producer_id, &rtp_capabilities) {
                bail!("router can not consume provided capabilities");
            }
            let Some(peer) = channel.peers.get_mut(&peer_id) else {
                bail!("peer ID not found in channel");
            };
            let Some(transport) = peer.transports.get_mut(&consumer_transport_id) else {
                bail!("transport ID not found in peer");
            };
            let consumer = transport.consume(ConsumerOptions::new(producer_id, rtp_capabilities)).await?;
            let consumer_2 = consumer.clone();
            let consumer_id = consumer.id().to_string();
            let channel_id = channel.channel_id;
            let tx_2 = tx.clone();
            let tx_3 = tx.clone();
            let consumer_id_2 = consumer_id.clone();
            let consumer_id_3 = consumer_id.clone();
            consumer.on_transport_close(move || {
                _ = tx_2.send(IncomingMessage::HandleClient {
                    channel: channel_id,
                    peer: peer_id,
                    message: FromClient::ConsumerClosed {
                        consumer_id: consumer_id_2.clone(),
                    }
                });
            }).detach();
            consumer.on_producer_close(move || {
                _ = tx_3.send(IncomingMessage::HandleClient {
                    channel: channel_id,
                    peer: peer_id,
                    message: FromClient::ConsumerClosed {
                        consumer_id: consumer_id_3.clone(),
                    }
                });
                _ = tx_3.send(IncomingMessage::MessageTo {
                    channel: channel_id,
                    peer: peer_id,
                    message: ToClient::ConsumerClosed(consumer_id_3.clone())
                });
            }).detach();

            let result = ToClient::ProducerConsumed {
                id: consumer_id.clone(),
                producer_id: producer_id.to_string(),
                kind: consumer.kind(),
                rtp_parameters: consumer.rtp_parameters().clone(),
            };



            peer.consumers.insert(consumer_id, consumer);

            if peer.deaf {
                consumer_2.pause().await?;
            }

            result
        }
        FromClient::ConsumerClosed{consumer_id} => {
            let Some(peer) = channel.peers.get_mut(&peer_id) else {
                bail!("peer ID not found in channel");
            };
            peer.producers.remove(&consumer_id);
            ToClient::Nothing
        }
        FromClient::GetProducers{} => {
            ToClient::NewProducers(channel.get_producers())
        }
    })
}

type ResponseSender = dyn futures_util::Sink<String, Error = anyhow::Error>
                      + Unpin;

async fn process_command(state: &mut State,
                         message: IncomingMessage,
                         tx: &UnboundedSender<IncomingMessage>,
                         server_write: &mut ResponseSender) -> Result<()> {
    match message {
        IncomingMessage::NewChannel{channel, codecs} => {
            let opt = RouterOptions::new(codecs);
            let router = state.worker.create_router(opt).await?; // TODO: This is a serious case...
            state.channels.insert(channel, Channel {
                channel_id: channel,
                router,
                peers: HashMap::new(),
                announce_ip: state.announce_ip,
                listen_ip: state.listen_ip,
            });
        }
        IncomingMessage::AddPeer{channel, peer} => {
            let Some(channel) = state.channels.get_mut(&channel) else {
                bail!("bad channel ID")
            };
            channel.peers.insert(peer, Peer {
                deaf: false,
                transports: HashMap::new(),
                producers: HashMap::new(),
                consumers: HashMap::new(),
            });
            _ = tx.send(IncomingMessage::MessageTo {
                channel: channel.channel_id,
                peer,
                message: ToClient::Capabilities(channel.router.rtp_capabilities().clone())
            });
        }
        IncomingMessage::RemovePeer{channel, peer} => {
            let Some(channel) = state.channels.get_mut(&channel) else {
                bail!("bad channel ID")
            };
            channel.peers.remove(&peer);
        }
        IncomingMessage::RemoveTransport{channel, peer, transport_id} => {
            let Some(channel) = state.channels.get_mut(&channel) else {
                bail!("bad channel ID");
            };
            let Some(peer) = channel.peers.get_mut(&peer) else {
                bail!("bad peer ID");
            };
            peer.transports.remove(&transport_id);
        }
        IncomingMessage::HandleClient{channel, peer, message} => {
            let Some(channel) = state.channels.get_mut(&channel) else {
                bail!("bad channel ID")
            };
            match process_client_command(channel, peer, message, &tx).await? {
                ToClient::Nothing => {},
                m => {
                    let wrapped = ToServer(channel.channel_id, peer, m);
                    if let Err(e) = server_write.send(serde_json::to_string(&wrapped).unwrap().into()).await {
                        bail!("could not send to server: {}", e)
                    }
                }
            }
        }
        IncomingMessage::SetDeafenPeer{channel, peer, deafen} => {
            let Some(channel) = state.channels.get_mut(&channel) else {
                bail!("bad channel ID");
            };
            let Some(peer) = channel.peers.get_mut(&peer) else {
                bail!("bad peer ID");
            };
            peer.deaf = deafen;
            for consumer in peer.consumers.values() {
                // TODO: Do this in parallel for each producer and then join!
                if deafen {
                    consumer.pause().await?;
                } else {
                    consumer.resume().await?;
                }
            }
        }
        IncomingMessage::BroadCast{channel, from_peer, message} => {
            let Some(channel) = state.channels.get_mut(&channel) else {
                bail!("bad channel ID");
            };
            let mut m = ToServer(channel.channel_id, usize::MAX, message);
            for peer in channel.peers.keys() {
                if from_peer == *peer {
                    continue
                }
                m.1 = *peer; // Send the recipient peer ID.
                if let Err(e) = server_write.send(serde_json::to_string(&m).unwrap()).await {
                    bail!("could not send to server: {}", e)
                }
            }
        }
        IncomingMessage::MessageTo{channel, peer, message} => {
            let m = ToServer(channel, peer, message);
            if let Err(e) = server_write.send(serde_json::to_string(&m).unwrap()).await {
                bail!("could not send to server: {}", e)
            }
        }
        IncomingMessage::Heartbeat => {
            // Because tokio-tungstenite doesn't seem to be well written enough
            // to live off of just WS ping/pongs.
            if let Err(e) = server_write.send("heartbeat".to_string()).await {
                println!("could not send heartbeat: {e}");
            }
        }
    }

    Ok(())
}

fn parse_log_level(s: &str) -> WorkerLogLevel {
    match s {
        "debug" => WorkerLogLevel::Debug,
        "warn" => WorkerLogLevel::Warn,
        "error" => WorkerLogLevel::Error,
        _ => WorkerLogLevel::None,
    }
}

fn parse_log_tag(s: &str) -> Option<WorkerLogTag> {
    match s {
        "" =>          None,
        "info" =>      Some(WorkerLogTag::Info),
        "ice" =>       Some(WorkerLogTag::Ice),
        "dtls" =>      Some(WorkerLogTag::Dtls),
        "rtp" =>       Some(WorkerLogTag::Rtp),
        "srtp" =>      Some(WorkerLogTag::Srtp),
        "rtcp" =>      Some(WorkerLogTag::Rtcp),
        "rtx" =>       Some(WorkerLogTag::Rtx),
        "bwe" =>       Some(WorkerLogTag::Bwe),
        "score" =>     Some(WorkerLogTag::Score),
        "simulcast" => Some(WorkerLogTag::Simulcast),
        "svc" =>       Some(WorkerLogTag::Svc),
        "sctp" =>      Some(WorkerLogTag::Sctp),
        "message" =>   Some(WorkerLogTag::Message),
        _ => panic!("unsupported log tag: {s}")
    }
}

// I have no idea why it wants 'static to be here. Frankly, I don't care.
fn after_websocket_started<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static>(ws_stream: tokio_tungstenite::WebSocketStream<S>, tx: UnboundedSender<IncomingMessage>) -> Box<ResponseSender> {
    use futures_util::StreamExt;

    let (write, mut read) = ws_stream.split();
    let write_mapped = write
        .with(|data| futures_util::future::ok(tokio_tungstenite::tungstenite::Message::text(data)))
        .sink_map_err(|e: tokio_tungstenite::tungstenite::error::Error|anyhow::anyhow!(e));
    tokio::spawn(async move {
        while let Some(message) = read.next().await {
            let message = match message {
                Ok(message) => message,
                Err(e) => { error!("failed to read message: {e}"); break }
            };

            if message.is_ping() {
                _ = tx.send(IncomingMessage::Heartbeat);
                continue
            }

            if !message.is_text() {
                continue
            }

            let tokio_tungstenite::tungstenite::Message::Text(msg) = message else { unreachable!(); };
            let message = match serde_json::from_str::<IncomingMessage>(&msg) {
                Ok(m) => m,
                Err(e) => { error!("bad message: {} for input {}", e, msg); continue }
            };
            if let Err(e) = tx.send(message) {
                error!("{}", e);
                break
            }
        }
        println!("read task closed");
    });

    Box::new(write_mapped)
}

async fn start_websocket(tx: UnboundedSender<IncomingMessage>) -> Box<ResponseSender> {
    let controller_url = std::env::var("SFU_CONTROLLER_URL")
        .expect("SFU_CONTROLLER_URL missing from env");
    println!("controller URL: {}", &controller_url);

    if controller_url.starts_with("ws://unix/") {
        // Assumed to be a Unix domain socket.

        #[cfg(not(windows))]
        {
            // This is not a conventional way of encounting a HTTP url going over domain sockets.
            // However, we start with the HTTP part, ignore the first colon (for protoco), and then once we reach the second colon, we find the
            // file path of the domain socket.
            let protocol = controller_url.find(':').expect("SFU_CONTROLLER_URL must contain two colons while in domain socket mode");
            let colon = controller_url[protocol + 1..].find(':').expect("SFU_CONTROLLER_URL must contain two colons while in domain socket mode") + protocol + 1;
            let http_path = &controller_url[0..colon];
            let unix_path = &controller_url[colon + 1..];
            let socket = tokio::net::UnixStream::connect(unix_path).await.unwrap();
            let (ws_stream, _) = tokio_tungstenite::client_async(http_path, socket).await.expect("SFU controller connection failed (unix domain socket)");
            return after_websocket_started(ws_stream, tx);
        }

        #[cfg(windows)]
        panic!("domain socket support is disabled on win32");
    } else {
        // Do it over HTTP instead.
        let url = url::Url::parse(&controller_url).unwrap();
        let (ws_stream, _) = tokio_tungstenite::connect_async(url).await.expect("SFU controller connection failed (http over tcp)");
        return after_websocket_started(ws_stream, tx);
    }; 
}

pub async fn start_worker() {
    env_logger::init();
    let manager = WorkerManager::new();

    let mut worker_settings = WorkerSettings::default();
    worker_settings.log_level = parse_log_level(&std::env::var("SFU_LOG_LEVEL").expect("SFU_LOG_LEVEL missing from env"));
    worker_settings.log_tags = std::env::var("SFU_LOG_TAGS")
        .expect("SFU_LOG_TAGS missing from env")
        .split(';')
        .filter_map(parse_log_tag).collect();
    let min_port = std::env::var("SFU_RTC_MIN_PORT").expect("SFU_RTC_MIN_PORT missing from env").parse().unwrap();
    let max_port = std::env::var("SFU_RTC_MAX_PORT").expect("SFU_RTC_MAX_PORT missing from env").parse().unwrap();
    worker_settings.rtc_port_range = std::ops::RangeInclusive::new(min_port, max_port);

    let listen_ip: std::net::IpAddr = std::env::var("SFU_LISTEN_IP").expect("SFU_LISTEN_IP missing from env").parse().unwrap();
    let announce_ip: std::net::IpAddr = std::env::var("SFU_ANNOUNCE_IP").expect("SFU_ANNOUNCE_IP missing from env").parse().expect("invalid IP for announce IP");

    let worker = manager.create_worker(worker_settings).await.expect("could not create SFU worker");

    println!("starting media worker");

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

    let mut write = start_websocket(tx.clone()).await;

    let mut state = State {
        worker,
        channels: HashMap::new(),
        listen_ip,
        announce_ip,
    };

    while let Some(message) = rx.recv().await {
        if let Err(e) = process_command(&mut state, message, &tx, write.as_mut()).await {
            error!("{}", e);
        }
    }
    error!("connection to SFU controller ended unexpectedly");
}
