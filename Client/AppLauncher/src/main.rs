#![cfg_attr(not(feature = "developer_tools"), windows_subsystem = "windows")]

// This launcher is a steaming pile of you know what. I do no like it. I wish for it to be
// rewritten some day. But for now it will do.

use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::process::Stdio;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::borrow::Cow;
use tokio::io::AsyncWriteExt;
use log::{error, info};
use rand::prelude::*;
use rand::distributions::Alphanumeric;
use sha2::{Sha512, Digest};
use hyper::{Body, Request, Response, Server, StatusCode};
use hyper::service::{make_service_fn, service_fn};

mod sal;

const APP_VERSION: Option<&str> = option_env!("CARGO_PKG_VERSION");
const APP_BUILDDATE: Option<&str> = option_env!("APP_BUILDDATE");
const APP_BUNDLED_TAR_GZ: Option<&str> = option_env!("APP_BUNDLED_TAR_GZ");
const APP_VERSION_FALLBACK: &str = "0.0.0";
const APP_BUILDDATE_FALLBACK: &str = "0";
const VERSIONS_DIR: &str = "versions";
const APP_NAME: &str = "TaigaChat"; // TODO: get from option_env instead?
const APP_LAUNCHER_NAME: &str = "TaigaChatLauncher";
macro_rules! app_env_prefix {
    () => ("TAIGACHAT_CLIENT_")
}

#[derive(Clone, Debug)]
struct Config {
   launch_build_tool: bool,
   silent_build_tool: bool,
   skip_launch: bool,
   npm: String,
   max_keybinds: usize,
   use_wayland: bool,
   newest_version: String,
   extra_flags: Vec<String>,
   latest_launcher_builddate: String,
   // TODO: Add safe mode
}

fn is_1(key: &str, s: &str) -> bool {
    if s == "1" {
        true
    } else if s == "0" {
        false
    } else {
        error!("config {}{} must either be 1 or 0", app_env_prefix!(), key);
        false
    }
}

impl Config {
    fn ingest_variables(&mut self, key: &str, value: &str) {
        match key {
            "LAUNCH_BUILD_TOOL" => self.launch_build_tool = is_1(key, value),
            "SILENT_BUILD_TOOL" => self.silent_build_tool = is_1(key, value),
            "NPM"               => self.npm               = value.into(),
            "USE_WAYLAND"       => self.use_wayland       = is_1(key, value),
            "SKIP_LAUNCH"       => self.skip_launch       = is_1(key, value),
            "MAX_KEYBINDS"   => self.max_keybinds = value.parse().unwrap(),
            "NEWEST_VERSION" => self.newest_version = value.into(),
            "EXTRA_FLAGS"    => self.extra_flags = value.split(',').map(|e|e.to_owned()).collect(), // TODO: Better parsing
            "LATEST_LAUNCHER_BUILDDATE" => {
                self.latest_launcher_builddate = String::from(value)
            },
            "ROOT" => {}
            _ => error!("unknown variable specified: {}{}", app_env_prefix!(), key)
        }
    }
    fn from_map(map: HashMap<String, String>) -> Self {
        let mut config = Config {
            launch_build_tool: false,
            silent_build_tool: false,
            skip_launch: false,
            npm: "pnpm".into(),
            max_keybinds: 8,
            use_wayland: false,
            newest_version: "".into(),
            extra_flags: vec![],
            latest_launcher_builddate: "".into(),
        };
        for (key, value) in map.iter() {
            let key_trimmed = key.trim_start_matches(app_env_prefix!());
            config.ingest_variables(key_trimmed, value);
        }
        return config;
    }
}

#[derive(Debug)]
enum ClientMonitorCommand {
    RESTART,
    SHUTDOWN,
}

fn get_versions_dir(launcher: &Launcher) -> PathBuf {
    let mut path = launcher.app_root.clone();
    path.push(VERSIONS_DIR);
    return path
}

fn get_specific_version_location(launcher: &Launcher, version: &str) -> PathBuf {
    if version == "" {
        return PathBuf::new()
    }
    let mut path = get_versions_dir(launcher);
    if version.ends_with(".tar.gz") {
        let without_extension = version.trim_end_matches(".tar.gz");
        path.push(without_extension);
        path.push(without_extension);

        if let Some(just_exe_name) = without_extension.split("-").next() {
            path.push(just_exe_name);
            return sal::set_proper_executable_extension(path)
        }

    }
    panic!("the launcher only supports launching .tar.gz files but tried to launch: {}", version);
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
    app_root: PathBuf,
    state: RwLock<LauncherState>,
    keybinds: Arc<std::sync::Mutex<sal::Keybinds>>,
    keyboard_listener: tokio::sync::broadcast::Sender<(u64, bool)>,
    config: RwLock<Config>,
    previous_mouse_clicks: std::sync::atomic::AtomicUsize,
}

fn save_install_info_to_disk(launcher: &Launcher, config: &Config) {
    let mut state = launcher.state.write().unwrap();
    state.is_changing_config = true;
    let mut path = launcher.app_root.clone();
    path.push("installation.env");
    _ = std::fs::write(path,
        format!("TAIGACHAT_LATEST_LAUNCHER_BUILDDATE={}\n\
                 TAIGACHAT_NEWEST_VERSION={}\n",
        config.latest_launcher_builddate, config.newest_version));
    state.is_changing_config = false;
}


fn get_extra_config(launcher: &Launcher) -> PathBuf {
    let mut extra = launcher.app_root.clone();
    extra.push("extraconfig.json");
    return extra
}

fn do_unpack_version_tar(launcher: &Launcher, mut path: PathBuf) -> anyhow::Result<()> {
    info!("extracting tar started ({path:#?})");
    let tar_gz = std::fs::File::open(&path)?;
    let tar = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(tar);

    path.set_extension("");
    let final_folder_name = path.file_stem().unwrap();
    let mut final_folder_path = get_versions_dir(launcher);
    final_folder_path.push(final_folder_name);
    archive.unpack(final_folder_path)?;
    info!("extracting tar done");
    Ok(())
}

async fn unpack_version_tar(launcher: Arc<Launcher>, output_path: PathBuf) {
    _ = tokio::task::spawn_blocking(move || {
        if let Err(e) = do_unpack_version_tar(&launcher, output_path) {
            error!("couldn't unpack tar: {e}");
        }
    }).await;
}

async fn send_sse(sse: &mut hyper::body::Sender, event: &str, data: &str) -> anyhow::Result<()> {
    sse.send_data(format!("event: {event}\r\ndata: {data}\r\n\r\n").into()).await?;
    Ok(())
}

async fn download_update(mut progress: hyper::body::Sender, launcher: Arc<Launcher>, url: String, filename: String) -> anyhow::Result<()> {
    if filename.contains("/") || filename.contains("\\") || filename.contains(":") {
        // TODO: Is there a more crossplatform way?
        anyhow::bail!("download_update() was given a strange destination filename")
    }
    {
        let mut state = launcher.state.write().unwrap();
        state.download_progress = 0;
        state.is_downloading = true;
    }
    let mut output_path = get_versions_dir(&launcher);
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

        send_sse(&mut progress, "updateProgress0", &format!("{bytes}")).await?;
    }

    let hash = base64::encode_config(hasher.finalize().to_vec(), base64::STANDARD_NO_PAD);

    info!("downloading {output_path:#?} done");
    output_file.flush().await?;
    drop(output_file);

    send_sse(&mut progress, "updateUnpacking0", "").await?;
    unpack_version_tar(launcher.clone(), output_path).await;

    launcher.state.write().unwrap().is_downloading = false;
    send_sse(&mut progress, "updateDone0", &hash).await?;

    Ok(())
}

async fn delete_version(version: &str, version2: &str, versions_dir: PathBuf) -> anyhow::Result<()> {
    let mut files = tokio::fs::read_dir(versions_dir).await?;
    info!("attempting to delete: {} and {}", version, version2);
    while let Some(entry) = files.next_entry().await? {
        let name = entry.file_name();
        if version != name && version2 != name {
            continue
        }
        info!("found matching file: deleting {:?}", entry.file_name());
        let file_type = entry.file_type().await.unwrap();
        if file_type.is_dir() {
            _ = tokio::fs::remove_dir_all(entry.path()).await;
        } else {
            _ = tokio::fs::remove_file(entry.path()).await;
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
                        launcher_port: u16,
                        mut rx: tokio::sync::mpsc::UnboundedReceiver<ClientMonitorCommand>) -> anyhow::Result<()> {
    if launcher.config.read().unwrap().skip_launch {
        error!("launch of client skipped!");
        return std::future::pending().await;
    }
    loop {
        let secret_code = launcher.secret_code.clone();
        let app_version = APP_VERSION.unwrap_or(APP_VERSION_FALLBACK);
        let version_or_npm;
        let running_from;
        let mut extra_flags;
        let mut launcher_web_server = "";
        {
            let config = launcher.config.read().unwrap();
            running_from = launcher.app_root.clone();
            extra_flags = config.extra_flags.clone();
            version_or_npm = if config.launch_build_tool {
                config.npm.clone().into()
            } else {
                let location = get_specific_version_location(&launcher, &config.newest_version);
                //println!("checking if {location:#?} exists");
                if !location.exists() {
                    // We might need to try and extract the files.
                    let mut output_path = get_versions_dir(&launcher);
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
                launcher_web_server = "http://localhost:8080";
            }
        }

        // TODO: On unix, we might want to not send the password over an environment variable.
        // This should still be reasonably safe at least on Linux (since /proc/*/envion isn't
        // world readable
        // TODO: Maybe the password should be changed between each launch to prevent other users
        // from connecting?
        let mut running_app_builder = tokio::process::Command::new(&version_or_npm);
        running_app_builder.stdin(Stdio::piped())
                           .env("LAUNCHER_BRIDGE_PASSWORD", format!("{launcher_port}-{secret_code}-{app_version}"))
                           .env("LAUNCHER_WEB_SERVER", launcher_web_server)
                           .current_dir(running_from)
                           .args(extra_flags);

        //println!("running: {:#?}", electron_builder);
        let running_app = running_app_builder.spawn();

        match running_app {
            Err(e) => {
                anyhow::bail!("could not start {version_or_npm:#?} {e}");
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
                let mut config = launcher.config.write().unwrap();
                config.newest_version = bundled_name.into();
                config.latest_launcher_builddate = APP_BUILDDATE.unwrap_or(APP_BUILDDATE_FALLBACK).into();
                save_install_info_to_disk(&launcher, &config);
            } else {
                anyhow::bail!(NOT_FOUND_ERROR);
            }
        }
    } else {
        anyhow::bail!(NOT_FOUND_ERROR);
    }
    Ok(())
}

fn read_key_value(filename: &Path, into: &mut HashMap<String, String>) -> std::io::Result<()> {
    let all = std::fs::read_to_string(filename)?;
    for line in all.lines() {
        let trimmed= line.trim();
        if trimmed.starts_with('#') {
            continue
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            into.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    Ok(())
}

fn get_app_root() -> Option<PathBuf> {
    if let Ok(v) = std::env::var(concat!(app_env_prefix!(), "ROOT")) {
        Some(v.into())
    } else {
        None
    }
}

fn happy_cors() -> hyper::http::response::Builder {
    Response::builder().header("Access-Control-Allow-Origin", "*")
}

fn response_text(s: String) -> anyhow::Result<Response<Body>> {
    Ok(happy_cors().body(Body::from(s)).unwrap())
}

fn response_ok() -> anyhow::Result<Response<Body>> {
    response_text(String::from("ok"))
}

async fn handle(mut req: Request<Body>, launcher: Arc<Launcher>) -> anyhow::Result<Response<Body>> {
    let path = req.uri().path();
    let mut words = path.split('/');

    let before_slash = words.next();
    let endpoint_prefix = words.next();
    if endpoint_prefix != Some("launcher0")
        && before_slash != Some("") {
        let response = happy_cors()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("endpoints start with launcher0"))
            .unwrap();
        return Ok(response)
    }

    let code = words.next();
    if code != Some(&launcher.secret_code) {
        let response = happy_cors()
            .status(StatusCode::UNAUTHORIZED)
            .body(Body::from("bad code"))
            .unwrap();
        return Ok(response)
    }

    match words.next() {
        Some("setAppSettings0") => {
            let content = hyper::body::to_bytes(req.body_mut()).await?;

            // TODO: An sqlite databse would be nicer. But would that be safe?
            let mut state = launcher.state.write().unwrap();
            if !state.is_changing_config {
                state.is_changing_config = true;
                let dest = get_extra_config(&launcher);
                std::fs::write(dest, content)?
            } else {
                let response = happy_cors()
                    .status(StatusCode::CONFLICT)
                    .body(Body::from("already changing settings"))
                    .unwrap();
                return Ok(response);
            }
            state.is_changing_config = false;

            response_ok()
        }
        Some("getAppSettings0") => {
            // TODO: What if file doesn't exist
            let dest = get_extra_config(&launcher);
            if dest.exists() {
                let read = tokio::fs::read(dest).await?;
                let config = String::from_utf8(read)?;
                response_text(config)
            } else {
                response_text(String::from(""))
            }
        }
        Some("setInterestingKeys0") => {
            let max_keybinds = { launcher.config.read().unwrap().max_keybinds };
            let keys: Vec<u64> = words.map(|e|e.parse().unwrap_or_default())
                                      .collect();
            if keys.len() > max_keybinds {
                let msg = format!("{} is the maximum number of key bindings allowed",
                                  max_keybinds);
                let response = happy_cors()
                    .status(StatusCode::BAD_REQUEST)
                    .body(Body::from(msg))
                    .unwrap();
                return Ok(response)
            }
            let mut bindings = launcher.keybinds.lock().unwrap();
            bindings.interested = keys;

            response_ok()
        }
        Some("enterKeybindMode0") => {
            let process_id = { launcher.state.read().unwrap().app_process_id };
            if sal::client_in_focus(process_id) {
                let mut bindings = launcher.keybinds.lock().unwrap();
                bindings.accept_all = true;
            }
            response_ok()
        }
        Some("keys0") => {
            let (mut sender, body) = Body::channel();

            let mut keyboard_listener = launcher.keyboard_listener.subscribe();
            tokio::spawn(async move {
                while let Ok(key) = keyboard_listener.recv().await {
                    let key_pressed = if key.1 { "1" } else { "0" };
                    let value = format!("{} {}", key.0, key_pressed);
                    _ = send_sse(&mut sender, "key0", &value).await;
                }
            });

            let response = happy_cors()
                .header("Cache-Control", "no-store")
                .header("Content-Type", "text/event-stream")
                .body(body)
                .unwrap();
            Ok(response)
        }
        Some("downloadUpdate0") => {
            if launcher.state.read().unwrap().is_downloading {
                let response = happy_cors()
                    .status(StatusCode::CONFLICT)
                    .body(Body::from("update is already being downloaded"))
                    .unwrap();
                Ok(response)
            } else {
                let query = req.uri().query().unwrap_or_default().as_bytes();
                let mut url: Cow<str> = "".into();
                let mut filename: Cow<str> = "".into();
                for (k, v) in url::form_urlencoded::parse(query) {
                    if k == "url" {
                        url = v;
                    } else if k == "filename" {
                        filename = v;
                    }
                }
                let (sender, body) = Body::channel();
                tokio::spawn(error_handler(download_update(sender,
                                                           launcher.clone(),
                                                           url.into_owned(),
                                                           filename.into_owned())));
                Ok(happy_cors()
                   .header("Content-Type", "text/event-stream")
                   .body(body).unwrap())
            }
        }
        Some("deleteVersion0") => {
            let version_bytes = hyper::body::to_bytes(req.body_mut()).await?;
            let version = String::from_utf8(version_bytes.to_vec())?;
            let versions_dir = get_versions_dir(&launcher);
            let newest_version = {
                let config = launcher.config.read().unwrap();
                config.newest_version.clone()
            };
            let without_extension = version.trim_end_matches(".tar.gz");
            if version == newest_version || version == without_extension {
                let response = happy_cors()
                    .status(StatusCode::FORBIDDEN)
                    .body(Body::from("can not delete latest version"))
                    .unwrap();
                Ok(response)
            } else {
                delete_version(&version, without_extension, versions_dir).await?;
                response_text(format!("{version} deleted"))
            }
        }
        Some("getVersions0") => {
            let versions_dir = get_versions_dir(&launcher);
            let mut files = tokio::fs::read_dir(versions_dir).await?;
            let mut versions = String::from("versions");
            while let Some(entry) = files.next_entry().await? {
                let name = entry.file_name();
                versions.push_str(" ");
                versions.push_str(name.to_str().unwrap());
            }
            response_text(versions)
        }
        Some("setNewestVersion0") => {
            let version = words.next().unwrap_or_default();
            let mut config = launcher.config.write().unwrap();
            config.newest_version = version.to_owned();
            save_install_info_to_disk(&launcher, &config);
            let path = get_specific_version_location(&launcher, &config.newest_version);
            sal::set_as_executable(path)?;
            response_ok()
        }
        Some("isActive0") => {
            let bindings = launcher.keybinds.lock().unwrap();
            let old = launcher.previous_mouse_clicks.swap(bindings.mouse_clicks, std::sync::atomic::Ordering::Relaxed);
            let differ = old != bindings.mouse_clicks;
            let answer = if differ { "userIsActive" } else { "userIsInactive" };
            response_text(String::from(answer))
        }
        Some("openURL0") => {
            let content = hyper::body::to_bytes(req.body_mut()).await?;
            let url_str = String::from_utf8(content.to_vec())?;
            let url = match url::Url::parse(&url_str) {
                Ok(u) => u.to_string(),
                Err(e) => {
                    error!("while opening url: {e}");
                    let response = happy_cors()
                        .status(StatusCode::BAD_REQUEST)
                        .body(Body::from("failed to parse URL"))
                        .unwrap();
                    return Ok(response)
                }
            };
            match open::that(url) {
                Err(e) => {
                    error!("while opening url: {e}");
                    let response = happy_cors()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Body::from("could not open URL"))
                        .unwrap();
                    Ok(response)
                }
                _ => response_ok(),
            }
        }
        Some("shutdownClient0") => {
            _ = launcher.restart.send(ClientMonitorCommand::SHUTDOWN)?;
            response_ok()
        }
        Some("minimizeClient0") => {
            sal::client_minimize();
            response_ok()
        }
        Some("maximizeClient0") => {
            sal::client_maximize();
            response_ok()
        }
        Some("restartClient0") => {
            _ = launcher.restart.send(ClientMonitorCommand::RESTART)?;
            response_ok()
        }
        Some(unknown) => {
            let response = happy_cors()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from(format!("{unknown} is an invalid endpoint")))
                .unwrap();
            Ok(response)
        }
        None => {
            let response = happy_cors()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("no endpoint provided"))
                .unwrap();
            Ok(response)
        }
    }
}

fn start_http_server(launcher: Arc<Launcher>) -> (u16, tokio::task::JoinHandle::<()>) {
    // Zero means pick any free port.
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));

    // Handle each connection.
    let make_service = make_service_fn(move |_conn| {
        let launcher_s = launcher.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                handle(req, launcher_s.clone())
            }))
        }
    });

    // Bind and start serving.
    let server = Server::bind(&addr).serve(make_service);
    let port = server.local_addr().port();

    // Create the task that runs the server.
    let server_task = tokio::spawn(async move {
        if let Err(e) = server.await {
            error!("server error: {}", e);
        }
    });

    return (port, server_task)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();
    if let Some(date) = APP_BUILDDATE {
        println!("{APP_LAUNCHER_NAME} {date}");
    }
    #[cfg(feature = "console-subscriber")]
    console_subscriber::init();

    let Some(app_root) = get_app_root()
        .or(sal::get_platform_specific_app_dir(APP_LAUNCHER_NAME)) else {
        error!("could not find app_root, please set TAIGACHAT_ROOT");
        return Ok(())
    };
    info!("app_root is: {:#?}", &app_root);
    _ = std::fs::create_dir_all(&app_root);

    let mut hash_map: HashMap<String, String> = HashMap::new();

    let mut app_installation = app_root.clone();
    app_installation.push("installation.env");
    if let Err(_) = read_key_value(&app_installation, &mut hash_map) {
        info!("installation.env has not been created yet");
    }

    let mut app_config = app_root.clone();
    app_config.push("launcher.env");
    if let Err(_) = read_key_value(&app_config, &mut hash_map) {
        info!("launcher.env was not found");
    }

    for (key, value) in std::env::vars() {
        if key.starts_with(app_env_prefix!()) {
            hash_map.insert(key, value);
        }
    }

    let keybinds = Arc::new(std::sync::Mutex::new(Default::default()));
    let (keyboard_listener_tx, _rx) = tokio::sync::broadcast::channel(128);
    let keyboard_task = sal::wait_for_keys(sal::KeyListener {
        sender: keyboard_listener_tx.clone(),
        keybinds: keybinds.clone(),
    }).await;

    let config = Config::from_map(hash_map);
    info!("app_config is: {:#?}", &config);

    // TODO: Really, a portion of config should be readonly and always accessible...
    let outdated_config = config.clone();

    #[cfg(not(feature = "developer_tools"))]
    if outdated_config.launch_build_tool {
        sal::simple_popup(APP_NAME, "Build tool is only available for launchers with the developer_tools feature enabled");
        return Ok(());
    }

    // TODO: This might not be necessary...
    //std::env::set_current_dir(&app_location).unwrap();

    let secret_code: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();


    let (restart_tx, restart_rx) = tokio::sync::mpsc::unbounded_channel();


    let launcher = Arc::new(Launcher {
        restart: restart_tx,
        app_root,
        secret_code: secret_code.clone(),
        state: RwLock::new(LauncherState {
            is_downloading: false,
            is_changing_config: false,
            download_progress: 0,
            app_process_id: 0,
        }),
        keybinds,
        previous_mouse_clicks: std::sync::atomic::AtomicUsize::new(0),
        keyboard_listener: keyboard_listener_tx,
        config: RwLock::new(config),
    });

    let (launcher_port, server_task) = start_http_server(launcher.clone());

    if outdated_config.latest_launcher_builddate != APP_BUILDDATE.unwrap_or(APP_BUILDDATE_FALLBACK)
        && !outdated_config.launch_build_tool {
        // If the launcher builddate has been changed, we default to using
        // the bundled version.
        sal::simple_popup(APP_NAME, "Launching the program for the first time might take some time");
        use_bundled_version(launcher.clone()).await?;
    }

    #[cfg(feature = "developer_tools")]
    let build_tool = if outdated_config.launch_build_tool {
        // TODO: yarn download dependencies first?

        // TODO: Make sure that the port that snowpack uses is free!
        info!("launching build tool from {:#?}", launcher.app_root);
        let mut cmd_builder = tokio::process::Command::new(outdated_config.npm);

        cmd_builder
            .current_dir(launcher.app_root.clone())
            .arg("exec")
            //.env("SNOWPACK_PUBLIC_CENTRAL_URL", "http://localhost:8014")
            .arg("vite").arg("--port").arg("8080");
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

    #[cfg(not(feature = "developer_tools"))]
    let build_tool = None;

    let launcher_monitor = launcher.clone();

    tokio::select! {
        _ = client_monitor(launcher_monitor, launcher_port, restart_rx) => {}
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
