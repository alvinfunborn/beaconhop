//! On-demand handoff to the independently installed Screen Buoy application.
//! The callback socket exists only for this request; there is no background service.
use crate::{hint_keys::ScreenBuoy, model::Destination};
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    version: u8,
    target: Option<Target>,
    port: u16,
    token: String,
    action: String,
    held_keys: Vec<u32>,
}
#[derive(Serialize)]
#[serde(
    tag = "scope",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
enum Target {
    Window {
        pid: u32,
        native_id: u64,
    },
    Desktop {
        desktop_id: String,
        display_id: String,
    },
}
impl From<&Destination> for Target {
    fn from(target: &Destination) -> Self {
        if target.desktop_target {
            Self::Desktop {
                desktop_id: target.desktop_id.clone(),
                display_id: target.display_id.clone(),
            }
        } else {
            Self::Window {
                pid: target.pid,
                native_id: target.native_id,
            }
        }
    }
}
#[derive(Debug, Deserialize, Serialize)]
pub struct Reply {
    #[serde(skip_serializing)]
    token: String,
    error: Option<String>,
    version: String,
    protocol: u8,
    permissions: serde_json::Value,
}

const RELEASES: &str = "https://github.com/alvinfunborn/screen-buoy/releases";
const MARKER: &str = "beaconhop-integration.json";

fn compatible(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    let marker = if parent.file_name().is_some_and(|s| s == "MacOS") {
        parent.join("../Resources").join(MARKER)
    } else {
        parent.join(MARKER)
    };
    std::fs::read(marker)
        .ok()
        .filter(|v| v.len() < 4096)
        .and_then(|v| serde_json::from_slice::<serde_json::Value>(&v).ok())
        .is_some_and(|v| v["protocol"] == 3)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    installed: bool,
    compatible: bool,
    path: String,
    platform: &'static str,
}

#[tauri::command]
pub fn get_screen_buoy_status(
    app: tauri::AppHandle,
    application_path: String,
) -> Result<Installation, String> {
    let config = ScreenBuoy {
        application_path,
        ..Default::default()
    };
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let path = self::application_path(&config, &home).ok();
    Ok(Installation {
        installed: path.is_some(),
        compatible: path.as_ref().is_some_and(|p| compatible(p)),
        path: path
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        platform: if cfg!(windows) { "windows" } else { "macos" },
    })
}

#[tauri::command]
pub async fn connect_screen_buoy(
    app: tauri::AppHandle,
    application_path: String,
    settings: bool,
) -> Result<Reply, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = self::application_path(
            &ScreenBuoy {
                application_path,
                ..Default::default()
            },
            &home,
        )?;
        exchange(
            &path,
            None,
            &[],
            if settings { "settings" } else { "status" },
            || true,
        )?
        .ok_or_else(|| "Connection cancelled".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn executable(path: PathBuf) -> PathBuf {
    if path.extension().is_some_and(|s| s == "app") {
        path.join("Contents/MacOS/screen-buoy")
    } else {
        path
    }
}

pub fn application_path(config: &ScreenBuoy, home: &Path) -> Result<PathBuf, String> {
    if !config.application_path.trim().is_empty() {
        let path = executable(PathBuf::from(config.application_path.trim()));
        return path
            .is_file()
            .then_some(path)
            .ok_or_else(|| "找不到指定的 SB 应用 / Screen Buoy application was not found".into());
    }
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    for directory in [PathBuf::from("/Applications"), home.join("Applications")] {
        for name in ["ScreenBuoy.app", "screen-buoy.app", "Screen Buoy.app"] {
            candidates.push(executable(directory.join(name)));
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = home;
        for variable in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(directory) = std::env::var_os(variable) {
                for folder in ["ScreenBuoy", "screen-buoy", "Programs/ScreenBuoy"] {
                    candidates.push(
                        PathBuf::from(&directory)
                            .join(folder)
                            .join("screen-buoy.exe"),
                    );
                }
            }
        }
    }
    if let Some(directory) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        candidates.push(directory.join(if cfg!(windows) {
            "screen-buoy.exe"
        } else {
            "screen-buoy"
        }));
    }
    candidates.into_iter().find(|path| path.is_file()).ok_or_else(||
        "请安装支持 BeaconHop 集成的 Screen Buoy，或在设置中填写应用路径 / Install a compatible Screen Buoy or set its application path".into())
}

fn line(stream: &mut TcpStream) -> Result<String, String> {
    let mut line = String::new();
    BufReader::new(stream.take(4096))
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    if !line.ends_with('\n') {
        return Err("Invalid Screen Buoy response".into());
    }
    Ok(line)
}

fn acknowledge(
    stream: &mut TcpStream,
    token: &str,
    current: impl Fn() -> bool,
) -> Result<Option<Reply>, String> {
    // Darwin inherits O_NONBLOCK from the listening socket. Once connected,
    // use bounded blocking reads so the peer can send its hello and reply.
    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|e| e.to_string())?;
    let hello: Reply = serde_json::from_str(&line(stream)?).map_err(|e| e.to_string())?;
    if hello.token != token {
        return Ok(None);
    }
    if let Some(error) = hello.error {
        return Err(error);
    }
    if hello.protocol != 3 {
        return Err("Incompatible Screen Buoy protocol".into());
    }
    if !current() {
        return Ok(None);
    }
    stream.write_all(b"begin\n").map_err(|e| e.to_string())?;
    let reply: Reply = serde_json::from_str(&line(stream)?).map_err(|e| e.to_string())?;
    if reply.token != token || reply.protocol != 3 {
        return Err("Invalid Screen Buoy acknowledgement".into());
    }
    if let Some(error) = reply.error {
        return Err(error);
    }
    Ok(Some(reply))
}

pub fn handoff(
    path: &Path,
    target: &Destination,
    held_keys: &[u32],
    current: impl Fn() -> bool,
) -> Result<(), String> {
    exchange(path, Some(target), held_keys, "hints", current).map(|_| ())
}

pub fn target_is_current(
    target: &Destination,
    snapshot: &crate::model::Snapshot,
    focused: Option<&str>,
) -> bool {
    if target.desktop_target {
        snapshot
            .desktops
            .iter()
            .any(|d| d.id == target.desktop_id && d.display_id == target.display_id && d.current)
    } else {
        focused == Some(target.id.as_str())
            && snapshot.windows.iter().any(|w| {
                w.id == target.id && w.pid == target.pid && w.native_id == target.native_id
            })
    }
}

fn launch_command(path: &Path) -> Command {
    #[cfg(target_os = "macos")]
    if let Some(bundle) = path
        .parent()
        .filter(|p| p.file_name().is_some_and(|n| n == "MacOS"))
        .and_then(Path::parent)
        .filter(|p| p.file_name().is_some_and(|n| n == "Contents"))
        .and_then(Path::parent)
        .filter(|p| p.extension().is_some_and(|n| n == "app"))
    {
        // Even a short-lived singleton forwarding process briefly activates
        // when its GUI binary is executed directly. Launch Services must start
        // it in the background so the target stays focused throughout handoff.
        // A new instance ensures argv reaches the singleton callback.
        let mut command = Command::new("/usr/bin/open");
        command.args(["-g", "-n"]).arg(bundle).arg("--args");
        return command;
    }
    Command::new(path)
}

fn exchange(
    path: &Path,
    target: Option<&Destination>,
    held_keys: &[u32],
    action: &str,
    current: impl Fn() -> bool,
) -> Result<Option<Reply>, String> {
    if !current() {
        return Ok(None);
    }
    if !compatible(path) {
        return Err("此 SB 版本不支持 BH 集成，请在集成设置中更新 / This Screen Buoy needs an integration-compatible update".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let token = uuid::Uuid::new_v4().to_string();
    let request = Request {
        version: 3,
        target: target.map(Target::from),
        port: listener.local_addr().map_err(|e| e.to_string())?.port(),
        token: token.clone(),
        action: action.into(),
        held_keys: held_keys.to_vec(),
    };
    let mut command = launch_command(path);
    command
        .arg("--beaconhop-request")
        .arg(serde_json::to_string(&request).unwrap())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动 SB / Could not start Screen Buoy: {e}"))?;
    // A fresh SB stays alive; an existing instance exits its forwarding process.
    // Reap either without making the handoff wait for application termination.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(8) {
        if !current() {
            return Ok(None);
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                if let Some(reply) = acknowledge(&mut stream, &token, &current)? {
                    return Ok(Some(reply));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(25))
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("SB 未响应。请退出正在运行的旧 SB 后重试，并检查系统是否阻止了启动 / Screen Buoy did not respond. Quit an older running copy and retry; check whether the OS blocked launch".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    version: String,
    compatible: bool,
}

fn stable_tag(tag: &str) -> Result<(), String> {
    if !tag.starts_with('v')
        || !semver::Version::parse(&tag[1..]).is_ok_and(|v| v.pre.is_empty() && v.build.is_empty())
    {
        return Err("Invalid stable Screen Buoy release".into());
    }
    Ok(())
}
fn download_url(tag: &str) -> Result<String, String> {
    stable_tag(tag)?;
    let asset = if cfg!(windows) {
        "screen-buoy-windows-setup.exe"
    } else {
        "screen-buoy-macos.zip"
    };
    Ok(format!("{RELEASES}/download/{tag}/{asset}"))
}

#[tauri::command]
pub async fn get_screen_buoy_download() -> Result<Download, String> {
    let client = reqwest::Client::builder()
        .user_agent("BeaconHop")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .head(format!("{RELEASES}/latest"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let tag = response
        .url()
        .as_str()
        .strip_prefix(&format!("{RELEASES}/tag/"))
        .ok_or("Unexpected release destination")?
        .to_owned();
    stable_tag(&tag)?;
    // Pin capability and asset checks to the same release, even during a rollout.
    let marker = client
        .get(format!("{RELEASES}/download/{tag}/{MARKER}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let supported = if marker.status() == reqwest::StatusCode::NOT_FOUND {
        false
    } else {
        let bytes = marker
            .error_for_status()
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;
        if bytes.len() > 4096 {
            return Err("Invalid Screen Buoy release manifest".into());
        }
        serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|e| e.to_string())?["protocol"]
            == 3
    };
    if supported {
        client
            .head(download_url(&tag)?)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
    }
    Ok(Download {
        version: tag,
        compatible: supported,
    })
}

#[tauri::command]
pub fn open_screen_buoy_download(tag: Option<String>) -> Result<(), String> {
    let url = tag
        .map(|t| download_url(&t))
        .transpose()?
        .unwrap_or_else(|| format!("{RELEASES}/latest"));
    #[cfg(target_os = "macos")]
    let status = Command::new("/usr/bin/open").arg(url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer.exe").arg(url).status();
    status.map_err(|e| e.to_string()).and_then(|s| {
        if s.success() {
            Ok(())
        } else {
            Err("Could not open download page".into())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_handoff_preserves_scope_without_a_focused_window() {
        use crate::model::{Desktop, Snapshot};
        let mut snapshot = Snapshot {
            desktops: vec![Desktop {
                id: "d".into(),
                display_id: "m".into(),
                current: true,
                ..Default::default()
            }],
            ..Default::default()
        };
        let target = Destination {
            desktop_target: true,
            desktop_id: "d".into(),
            display_id: "m".into(),
            ..Default::default()
        };
        assert!(target_is_current(&target, &snapshot, None));
        assert!(target_is_current(&target, &snapshot, Some("any-window")));
        assert_eq!(
            serde_json::to_value(Target::from(&target)).unwrap(),
            serde_json::json!({"scope":"desktop","desktopId":"d","displayId":"m"})
        );
        snapshot.desktops[0].current = false;
        assert!(!target_is_current(&target, &snapshot, None));
        snapshot.desktops.clear();
        assert!(!target_is_current(&target, &snapshot, None));
        let window = Destination {
            id: "window".into(),
            pid: 23,
            native_id: 42,
            ..Default::default()
        };
        snapshot.windows.push(window.clone());
        assert!(target_is_current(&window, &snapshot, Some("window")));
        assert!(!target_is_current(&window, &snapshot, None));
        assert_eq!(
            serde_json::to_value(Target::from(&window)).unwrap(),
            serde_json::json!({"scope":"window","pid":23,"nativeId":42})
        );
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn bundled_requests_launch_in_background_and_deliver_arguments_to_a_new_instance() {
        let command = launch_command(Path::new(
            "/Apps/Screen Buoy.app/Contents/MacOS/screen-buoy",
        ));
        assert_eq!(command.get_program(), "/usr/bin/open");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            ["-g", "-n", "/Apps/Screen Buoy.app", "--args"]
        );
        let standalone = launch_command(Path::new("/tools/screen-buoy"));
        assert_eq!(standalone.get_program(), "/tools/screen-buoy");
        assert_eq!(standalone.get_args().count(), 0);
    }
    #[test]
    fn callback_requires_matching_token_current_gesture_and_successful_ack() {
        for scenario in [
            "ok",
            "wrong-token",
            "cancelled",
            "permission-error",
            "wrong-ack",
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            listener.set_nonblocking(true).unwrap();
            let address = listener.local_addr().unwrap();
            let peer = std::thread::spawn(move || {
                let mut stream = TcpStream::connect(address).unwrap();
                std::thread::sleep(Duration::from_millis(50));
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let token = if scenario == "wrong-token" {
                    "wrong"
                } else {
                    "expected"
                };
                let hello = serde_json::json!({ "token": token, "error": null, "version": "1.4.3", "protocol": 3, "permissions": { "ready": true } });
                writeln!(stream, "{hello}").unwrap();
                if scenario == "wrong-token" || scenario == "cancelled" {
                    let mut byte = [0];
                    assert_eq!(stream.read(&mut byte).unwrap(), 0);
                    return;
                }
                assert_eq!(line(&mut stream).unwrap(), "begin\n");
                let mut ack = hello;
                if scenario == "permission-error" {
                    ack["error"] = "Permission required".into();
                }
                if scenario == "wrong-ack" {
                    ack["token"] = "wrong".into();
                }
                writeln!(stream, "{ack}").unwrap();
            });
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => panic!("Callback did not connect: {error}"),
                }
            };
            // Reproduce Darwin's inherited flag on every test platform.
            stream.set_nonblocking(true).unwrap();
            let result = acknowledge(&mut stream, "expected", || scenario != "cancelled");
            drop(stream);
            match scenario {
                "ok" => assert_eq!(result.unwrap().unwrap().permissions["ready"], true),
                "wrong-token" | "cancelled" => assert!(result.unwrap().is_none()),
                _ => assert!(result.is_err()),
            }
            peer.join().unwrap();
        }
    }
    #[test]
    fn installation_capability_is_offline_and_downloads_stay_on_the_official_channel() {
        let dir = std::env::temp_dir().join(format!("bh-sb-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let binary = dir.join("screen-buoy");
        assert!(!compatible(&binary));
        std::fs::write(dir.join(MARKER), r#"{"protocol":1}"#).unwrap();
        assert!(!compatible(&binary));
        std::fs::write(dir.join(MARKER), r#"{"protocol":2}"#).unwrap();
        assert!(!compatible(&binary));
        std::fs::write(dir.join(MARKER), r#"{"protocol":3}"#).unwrap();
        assert!(compatible(&binary));
        std::fs::remove_dir_all(dir).unwrap();
        assert!(download_url("v1.5.0")
            .unwrap()
            .starts_with(&format!("{RELEASES}/download/v1.5.0/")));
        for invalid in [
            "../other",
            "v1.5.0/else",
            "v1.5.0-beta.1",
            "latest",
            "https://example.com",
        ] {
            assert!(download_url(invalid).is_err());
        }
    }
    #[test]
    fn explicit_missing_application_does_not_fall_back_or_launch_another_app() {
        let config = ScreenBuoy {
            application_path: "/missing/ScreenBuoy.app".into(),
            ..Default::default()
        };
        assert!(application_path(&config, Path::new("/missing")).is_err());
        assert_eq!(
            executable(PathBuf::from("/Apps/ScreenBuoy.app")),
            PathBuf::from("/Apps/ScreenBuoy.app/Contents/MacOS/screen-buoy")
        );
    }
}
