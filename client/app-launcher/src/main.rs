#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, RwLock};
use std::process::Stdio;
use std::net::SocketAddr;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio_tungstenite::accept_async;
use log::{error, info};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use clap::Parser;
use rand::prelude::*;
use rand::distributions::Alphanumeric;
use sha2::{Sha512, Digest};

mod sal;

const APP_VERSION: Option<&str> = option_env!("CARGO_PKG_VERSION");
const APP_BUILDDATE: Option<&str> = option_env!("APP_BUILDDATE");
const APP_BUNDLED_TAR_GZ: Option<&str> = option_env!("APP_BUNDLED_TAR_GZ");
const APP_VERSION_FALLBACK: &str = "0.0.0";
const APP_BUILDDATE_FALLBACK: &str = "0";
const VERSIONS_DIR: &str = "versions";
const APP_LAUNCHER_CONFIG: &str = "taigachat.launcher.json";
const APP_CONFIG: &str = "taigachat.json";
const APP_NAME: &str = "TaigaChat"; // TODO: get from option_env instead?
const APP_LAUNCHER_NAME: &str = "TaigaChatLauncher";

fn default_max_keybinds() -> usize {
    return 8
}

/// Struct for parsing command line arguments
/// and the config file.
#[derive(Parser, Debug, Serialize, Deserialize, Clone)]
#[clap(author, version, about, long_about = None)]
struct Args {
   #[clap(long, action = clap::ArgAction::Set, default_value_t = false, default_missing_value = "true")]
   #[serde(default)]
   launch_build_tool: bool,

   #[clap(long, action = clap::ArgAction::Set, default_value_t = false, default_missing_value = "true")]
   #[serde(default)]
   silent_build_tool: bool,

   #[clap(long, action = clap::ArgAction::Set, default_value_t = false, default_missing_value = "true")]
   #[serde(default)]
   use_npm: bool,

   #[clap(long, action = clap::ArgAction::Set, default_value_t = 8)]
   #[serde(default = "default_max_keybinds")]
   max_keybinds: usize,

   #[clap(long, action = clap::ArgAction::Set, default_value_t = false, default_missing_value = "true")]
   #[serde(default)]
   use_wayland: bool,

   #[clap(long = "app-location")]
   #[serde(default)]
   app_location: Option<std::path::PathBuf>,

   #[clap(long, default_value = "")]
   #[serde(default)]
   newest_version: String,

   #[clap(long, action = clap::ArgAction::Append)]
   #[serde(default)]
   extra_flags: Vec<String>,

   #[clap(skip)]
   #[serde(default)]
   latest_launcher_builddate: String,

   // TODO: Add safe mode
}

impl Args {
    fn get_specific_version_location(&self, version: &str) -> std::path::PathBuf {  
        if version == "" {
            return std::path::PathBuf::new()
        }
        let mut path = self.app_location.clone().unwrap();
        path.push(VERSIONS_DIR);
        if version.ends_with(".tar.gz") {
            if let Some(without_extension) = version.strip_suffix(".tar.gz") {
                path.push(without_extension);
                path.push(without_extension);

                if let Some(just_exe_name) = without_extension.split("-").next() {
                    path.push(just_exe_name);
                    return sal::set_proper_executable_extension(path)
                }
            }

        }
        panic!("the launcher only supports launching .tar.gz files");
    }
    fn get_yarn(&self) -> &'static str {
        if self.use_npm { sal::get_npm() } else { sal::get_yarn() }
    }
    fn unpack_version_tar(&self, mut path: std::path::PathBuf) -> anyhow::Result<()> {
        info!("extracting tar started ({path:#?})");
        let tar_gz = std::fs::File::open(&path)?;
        let tar = flate2::read::GzDecoder::new(tar_gz);
        let mut archive = tar::Archive::new(tar);

        path.set_extension("");
        let final_folder_name = path.file_stem().unwrap();
        let mut final_folder_path = self.app_location.clone().unwrap();
        final_folder_path.push(VERSIONS_DIR);
        final_folder_path.push(final_folder_name);
        archive.unpack(final_folder_path)?;
        info!("extracting tar done");
        Ok(())
    }
    fn get_app_config(&self) -> std::path::PathBuf {
        let mut buf = self.app_location.clone().unwrap();
        buf.push(APP_CONFIG);
        buf
    }
}

#[derive(Debug)]
enum ClientMonitorCommand {
    RESTART,
    SHUTDOWN,
}

fn get_app_dir() -> std::path::PathBuf {
    if let Ok(mut path) =  std::env::current_exe() {
        path.pop();
        path.push(APP_LAUNCHER_CONFIG);
        if path.exists() {
            path.pop();
            return path;
        }
    }
    if let Some(data_dir) = sal::get_platform_specific_app_dir(APP_LAUNCHER_NAME) {
        _ = std::fs::create_dir_all(&data_dir);
        return data_dir;
    }
    return std::env::current_dir().unwrap();
}

// TODO: Remove all config loading in favour of environment and .env based configs.
fn load_config() -> anyhow::Result<Args> {
    let args = Args::parse();
    let app_location = args.app_location.clone().unwrap_or_else(get_app_dir);
    let mut config = app_location.clone();
    config.push(APP_LAUNCHER_CONFIG);
    let mut loaded_config = if config.exists() {
        let matches = <Args as clap::CommandFactory>::command().get_matches();
        let a = serde_json::value::to_value(args)?;
        let file = std::fs::read_to_string(config)?;
        let mut b: serde_json::Value = serde_json::from_str(&file)?;
        for (key, v) in a.as_object().unwrap().iter() {
            let adjusted_key = key.replace("_", "-");
            if matches.try_contains_id(&adjusted_key).is_ok() {
                if let Some(source) = matches.value_source(&adjusted_key) {
                    if source != clap::ValueSource::DefaultValue {
                        info!("override {key}");
                        b[key] = v.clone();
                    }
                }
            } else {
                info!("{key} does not want to be overriden");
            }
        }
        serde_json::from_value(b)?
    } else {
        info!("running without config file");
        args
    };
    loaded_config.app_location = Some(dunce::canonicalize(app_location)?);
    Ok(loaded_config)
}

struct LauncherState {
    is_downloading: bool,
    is_changing_config: bool,
    download_progress: usize,
    app_process_id: u32,
}

struct Launcher {
    restart: tokio::sync::mpsc::UnboundedSender<ClientMonitorCommand>,
    secret_code: String,
    launcher_port: u16,
    state: RwLock<LauncherState>,
    keybinds: Arc<std::sync::Mutex<sal::Keybinds>>,
    keyboard_listener: tokio::sync::broadcast::Sender<(u64, bool)>,
    config: RwLock<Args>,
}

impl Launcher {
    async fn update_settings<F: Fn(&mut Args) -> [&'static str; T], const T: usize>(self: &Arc<Launcher>, f: F) -> anyhow::Result<()> {
        let prop_updates: [(&'static str, serde_json::Value); T];
        let mut config = {
            let mut write = self.config.write().unwrap();
            let running_from = write.app_location.clone().unwrap();
            let props = f(&mut write);
            let new_json = serde_json::to_value(&*write)?;
            prop_updates = core::array::from_fn(|i|(props[i], new_json[props[i]].clone()));
            running_from
        };
        // TODO: What happens if this is procedure is called from another context before it is
        // finished?

        config.push(APP_LAUNCHER_CONFIG);
        // TODO: This could already have been read into memory.
        let mut current = if config.exists() {
            let file = tokio::fs::read_to_string(config.clone()).await?;
            serde_json::from_str(&file)?
        } else {
            serde_json::value::Map::new()
        };
        for (prop, value) in prop_updates {
            current.insert(prop.into(), value);
        }

        let s = serde_json::to_string_pretty(&current)?;
        tokio::fs::write(config, s).await?;
        Ok(())
    }
}

async fn unpack_version_tar(launcher: Arc<Launcher>, output_path: std::path::PathBuf) {
    _ = tokio::task::spawn_blocking(move || {
        let config = launcher.config.read().unwrap();
        if let Err(e) = config.unpack_version_tar(output_path) {
            error!("couldn't unpack tar: {e}");
        }
    }).await;
}

async fn download_update(response: tokio::sync::mpsc::UnboundedSender<String>, launcher: Arc<Launcher>, url: String, filename: String) -> anyhow::Result<()> {
    if filename.contains("/") || filename.contains("\\") || filename.contains(":") {
        // TODO: Is there a more crossplatform way?
        anyhow::bail!("download_update() was given a strange destination filename")
    }
    {
        let mut state = launcher.state.write().unwrap();
        state.download_progress = 0;
        state.is_downloading = true;
    }
    let mut output_path = {
        launcher.config.read().unwrap().app_location.clone().unwrap()
    };
    output_path.push(VERSIONS_DIR);
    tokio::fs::create_dir_all(&output_path).await?;
    output_path.push(filename);
    let mut output_file = tokio::fs::File::create(&output_path).await?;

    let mut http_response = reqwest::get(url).await?;
    let mut bytes = 0;
    let mut hasher = Sha512::new();
    while let Some(chunk) = http_response.chunk().await? {
        bytes += chunk.len();
        hasher.update(&chunk);
        output_file.write_all(&chunk).await?;
        response.send(format!("update-progress {bytes}"))?;
    }

    let hash = base64::encode_config(hasher.finalize().to_vec(), base64::STANDARD_NO_PAD);

    info!("downloading {output_path:#?} done");
    output_file.flush().await?;
    drop(output_file);

    response.send(format!("update-unpacking"))?;
    unpack_version_tar(launcher.clone(), output_path).await;

    launcher.state.write().unwrap().is_downloading = false;
    response.send(format!("update-done {hash}"))?;
    Ok(())
}

async fn handle_client_commmand(text: String, launcher: &Arc<Launcher>, tx: &tokio::sync::mpsc::UnboundedSender<String>, previous_mouse_clicks: &mut usize) -> anyhow::Result<()> {
    let mut words = text.split(' ');
    match words.next() {
        Some("set-app-settings") => {
            let mut state = launcher.state.write().unwrap();
            let caught_error = if !state.is_changing_config {
                state.is_changing_config = true;
                let source = &text[17..];
                let dest = { launcher.config.read().unwrap().get_app_config() };
                std::fs::write(dest, source)
            } else { Ok(()) };
            state.is_changing_config = false;
            caught_error?;
        }
        Some("get-app-settings") => {
            // TODO: What if file doesn't exist
            let dest = { launcher.config.read().unwrap().get_app_config() };
            if dest.exists() {
                let read = tokio::fs::read(dest).await?;
                let config = std::str::from_utf8(&read)?;
                _ = tx.send(format!("app-settings {config}"));
            } else {
                _ = tx.send(format!("app-settings"));
            }
        }
        Some("set-interesting-keys") => {
            let max_keybinds = { launcher.config.read().unwrap().max_keybinds };
            let keys: Vec<u64> = words.map(|e|e.parse().unwrap_or_default())
                                      .collect();
            if keys.len() > max_keybinds {
                tx.send(format!("suspiciously many keybinds set, max is: {}", max_keybinds))?;
            }
            let mut bindings = launcher.keybinds.lock().unwrap();
            bindings.interested = keys;
        }
        Some("enter-keybind-mode") => {
           let process_id = { launcher.state.read().unwrap().app_process_id };
            if sal::client_in_focus(process_id) {
                let mut bindings = launcher.keybinds.lock().unwrap();
                bindings.accept_all = true;
            }
        }
        Some("download-update") => {
            if launcher.state.read().unwrap().is_downloading {
                tx.send("update is already being downloaded".into())?;
            } else {
                let url = words.next().unwrap_or_default().to_owned();
                let filename = words.next().unwrap_or_default().to_owned();
                tokio::spawn(error_handler(download_update(tx.clone(), launcher.clone(), url, filename)));
            }
        }
        Some("set-newest-version") => {
            let version = words.next().unwrap_or_default();
            launcher.update_settings(move |c| {
                c.newest_version = version.to_owned();
                ["newest_version"]
            }).await?;
            {
                let config = launcher.config.read().unwrap();
                let path = config.get_specific_version_location(&config.newest_version);
                sal::set_as_executable(path)?;
            }
            tx.send("reload-ready".into())?;
        }
        Some("is-active") => {
            let bindings = launcher.keybinds.lock().unwrap();
            let differ = *previous_mouse_clicks != bindings.mouse_clicks;
            *previous_mouse_clicks = bindings.mouse_clicks;
            let answer = if differ { "user-is-active" } else { "user-is-inactive" };
            tx.send(answer.into())?;
        }
        Some("open-url") => {
            let url_str = words.next().unwrap_or_default();
            let url = match url::Url::parse(url_str) {
                Ok(u) => u.to_string(),
                Err(e) => {
                    _ = tx.send("open-url-fail".into());
                    error!("while opening url: {e}");
                    return Ok(())
                }
            };
            _ = tx.send(match open::that(url) {
                Err(e) => {
                    error!("while opening url: {e}");
                    "open-url-fail"
                }
                _ => {"open-url-ok"},
            }.into());
        }
        Some("shutdown-client") => {
            _ = launcher.restart.send(ClientMonitorCommand::SHUTDOWN)?;
        }
        Some("minimize-client") => {
            sal::client_minimize();
        }
        Some("maximize-client") => {
            sal::client_maximize();
        }
        Some("restart-client") => {
            _ = launcher.restart.send(ClientMonitorCommand::RESTART)?;
        }
        _ => {
            tx.send("error".into())?;
        }
    }
    return Ok(())
}

async fn handle_client(launcher: Arc<Launcher>, stream: tokio_tungstenite::WebSocketStream<TcpStream>) -> anyhow::Result<()> {
    let mut authenticated = false;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let (mut sink, mut stream) = stream.split();

    let mut keyboard_listener = launcher.keyboard_listener.subscribe();
    tokio::spawn(error_handler(async move {
        loop {
            tokio::select! {
                Ok(key) = keyboard_listener.recv() => {
                    let msg = format!("key {} {}", key.0, if key.1 { "1" } else { "0" });
                    sink.send(tokio_tungstenite::tungstenite::Message::Text(msg)).await?;
                }
                msg = rx.recv() => {
                    if let Some(msg) = msg {
                        sink.send(tokio_tungstenite::tungstenite::Message::Text(msg)).await?;
                    } else {
                        break
                    }
                }
            }
        }
        while let Some(msg) = rx.recv().await {
            sink.send(tokio_tungstenite::tungstenite::Message::Text(msg)).await?;
        }
        Ok::<(), anyhow::Error>(())
    }));
    let mut previous_mouse_clicks = 0;
    while let Some(msg) = stream.next().await {
        let msg = msg?;
        if msg.is_binary() {
            break
        }
        let text = msg.into_text()?;
        if authenticated {
            handle_client_commmand(text, &launcher, &tx, &mut previous_mouse_clicks).await?;
        } else {
            if text == launcher.secret_code {
                authenticated = true
            } else {
                break
            }
        }
    }
    Ok(())
}


async fn error_handler<F: std::future::Future<Output = anyhow::Result<()>>>(f: F) -> () {
    if let Err(e) = f.await {
        error!("error from async task: {e}");
    }
}

async fn client_monitor(launcher: Arc<Launcher>,
                        mut rx: tokio::sync::mpsc::UnboundedReceiver<ClientMonitorCommand>) -> anyhow::Result<()> {
    if std::env::var("TAIGACHAT_DONT_LAUNCH") == Ok(String::from("1")) {
        error!("launch of client skipped!");
        return std::future::pending().await;
    }
    loop {
        let launcher_port = launcher.launcher_port;
        let secret_code = launcher.secret_code.clone();
        let app_version = APP_VERSION.unwrap_or(APP_VERSION_FALLBACK);
        let version_or_yarn_or_npm;
        let running_from;
        let mut extra_flags;
        {
            let config = launcher.config.read().unwrap();
            running_from = config.app_location.clone().unwrap();
            extra_flags = config.extra_flags.clone();
            version_or_yarn_or_npm = if config.launch_build_tool { 
                config.get_yarn().into()
            } else { 
                let location = config.get_specific_version_location(&config.newest_version);
                //println!("checking if {location:#?} exists");
                if !location.exists() {    
                    // We might need to try and extract the files.
                    let mut output_path = config.app_location.clone().unwrap();
                    output_path.push(VERSIONS_DIR);
                    output_path.push(&config.newest_version);
                    unpack_version_tar(launcher.clone(), output_path).await;
                } 
                location
            };
            if config.use_wayland {
                info!("using wayland");
                extra_flags.push("--enable-features=UseOzonePlatform".into());
                extra_flags.push("--ozone-platform=wayland".into());
            }
            if config.launch_build_tool {
                extra_flags.insert(0, "electron".into());
                extra_flags.push("index.js".into());
                extra_flags.push("--launcher-bridge".into());
                extra_flags.push("--web-server".into());
                extra_flags.push("http://localhost:8080".into());
            }
        }

        // TODO: On unix, we might want to not send the password over an environment variable.
        // This should still be reasonably safe at least on Linux (since /proc/*/envion isn't
        // world readable
        // TODO: Maybe the password should be changed between each launch to prevent other users
        // from connecting?
        let mut running_app_builder = tokio::process::Command::new(&version_or_yarn_or_npm);
        running_app_builder.stdin(Stdio::piped())
                           .env("LAUNCHER_BRIDGE_PASSWORD", format!("{launcher_port}-{secret_code}-{app_version}"))
                           .current_dir(running_from);

        for arg in extra_flags {
            running_app_builder.arg(arg);
        }
        //println!("running: {:#?}", electron_builder);
        let running_app = running_app_builder.spawn();

        match running_app {
            Err(e) => {
                anyhow::bail!("could not start {version_or_yarn_or_npm:#?} {e}");
            }
            Ok(mut e) => {
                if let Some(id) = e.id() {
                    launcher.state.write().unwrap().app_process_id = id;
                }
                tokio::select! {
                    _ = e.wait() => { break }
                    cmd = rx.recv() => {
                        info!("restart signal received");
                        sal::kill_recursive(e);
                        info!("we live");
                        match cmd {
                            Some(ClientMonitorCommand::SHUTDOWN) => break,
                            Some(ClientMonitorCommand::RESTART) => continue,
                            None => break,
                        }
                    }
                }
            }
        };
    }
    Ok(())
}

async fn use_bundled_version(launcher: Arc<Launcher>) -> anyhow::Result<()> {
    const NOT_FOUND_ERROR: &str = "couldn't find the missing tar.gz file";
    if let Ok(mut path) = std::env::current_exe() {
        path.pop();
        if let Some(bundled_name) = APP_BUNDLED_TAR_GZ {
            path.push(bundled_name);
            if path.exists() {
                unpack_version_tar(launcher.clone(), path.clone()).await;
                launcher.update_settings(move |c| {
                    c.newest_version = bundled_name.into();
                    c.latest_launcher_builddate = APP_BUILDDATE.unwrap_or(APP_BUILDDATE_FALLBACK).into();
                    ["newest_version", "latest_launcher_builddate"]
                }).await?;
            } else {
                anyhow::bail!(NOT_FOUND_ERROR);
            }
        }
    } else {
        anyhow::bail!(NOT_FOUND_ERROR);
    }
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();
    if let Some(date) = APP_BUILDDATE {
        println!("{APP_LAUNCHER_NAME} {date}");
    }
    #[cfg(feature = "console-subscriber")]
    console_subscriber::init();

    let keybinds = Arc::new(std::sync::Mutex::new(Default::default()));
    let (keyboard_listener_tx, _rx) = tokio::sync::broadcast::channel(128);
    let keyboard_task = sal::wait_for_keys(sal::KeyListener {
        sender: keyboard_listener_tx.clone(),
        keybinds: keybinds.clone(),
    }).await;
    /*tokio::spawn(async move {
        while let Ok(v) = rx.recv().await {
            println!("key: {v:#?}");
        }
    });*/
    let config = load_config()?;
    let outdated_config = config.clone();

    let app_location = config.app_location.to_owned().unwrap();

    // TODO: This might not be necessary...
    std::env::set_current_dir(&app_location).unwrap();

    let secret_code: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();

    // Zero means pick any free port
    let addr: SocketAddr = ([127, 0, 0, 1], 0).into();

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let launcher_port = listener.local_addr()?.port();

    let (restart_tx, restart_rx) = tokio::sync::mpsc::unbounded_channel();


    let launcher = Arc::new(Launcher {
        restart: restart_tx,
        launcher_port,
        secret_code: secret_code.clone(),
        state: RwLock::new(LauncherState {
            is_downloading: false,
            is_changing_config: false,
            download_progress: 0,
            app_process_id: 0,
        }),
        keybinds,
        keyboard_listener: keyboard_listener_tx,
        config: RwLock::new(config),
    });

    if outdated_config.latest_launcher_builddate != APP_BUILDDATE.unwrap_or(APP_BUILDDATE_FALLBACK) 
        && !outdated_config.launch_build_tool {
        // If the launcher builddate has been changed, we default to using
        // the bundled version.
        sal::simple_popup(APP_NAME, "Launching the program for the first time might take some time");
        use_bundled_version(launcher.clone()).await?;
    }

    let build_tool = if outdated_config.launch_build_tool {
        // TODO: yarn download dependencies first?

        // TODO: Make sure that the port that snowpack uses is free!
        info!("launching build tool from {:#?}", outdated_config.app_location);
        let mut cmd_builder = tokio::process::Command::new(outdated_config.get_yarn());
        cmd_builder
            .current_dir(outdated_config.app_location.unwrap())
            .arg("snowpack").arg("dev")
            .env("SNOWPACK_PUBLIC_VERSION", "developer")
            .env("SNOWPACK_PUBLIC_CSP", "; script-src 'unsafe-inline' 'self'")
            //.env("SNOWPACK_PUBLIC_CENTRAL_URL", "http://localhost:8014")
            .env("SNOWPACK_PUBLIC_CENTRAL_URL", "")
            .env("SNOWPACK_PUBLIC_UPDATE_URL", "");
        if outdated_config.silent_build_tool {
            cmd_builder.stdout(Stdio::null());
        }
        info!("{cmd_builder:#?}");
        let cmd = cmd_builder
            .spawn()
            .expect("could not start build tool");

        info!("waiting for build tool to go online");
        for i in 0 .. 50 {
            if i == 49 {
                println!("could not connect to build tool in time, launching anyway");
                break
            }
            match tokio::net::TcpStream::connect("localhost:8080").await {
                Ok(mut stream) => {
                    stream.shutdown().await?;
                    break
                }
                Err(_) => tokio::time::sleep(tokio::time::Duration::from_millis(100)).await,
            }
        }
        info!("done waiting for build tool");

        Some(cmd)
    } else { None };
 
    let launcher_monitor = launcher.clone();

    let server_task = tokio::spawn(error_handler(async move {
        while let Ok((stream, _)) = listener.accept().await {
            if let Ok(stream) = accept_async(stream).await {
                tokio::spawn(error_handler(handle_client(launcher.clone(), stream)));
            }
        }
        anyhow::Ok(())
    }));

    tokio::select! {
        _ = client_monitor(launcher_monitor, restart_rx) => {}
        _ = tokio::signal::ctrl_c() => {}
    };

    server_task.abort();
    keyboard_task.stop();
    if let Some(build_tool) = build_tool {
        info!("killing build-tool");
        sal::kill_recursive(build_tool);
    }
    Ok(())
}
