//! First-party installers. Only bundled code and the configured official store listing
//! may be installed; third-party metadata never grants installation authority.
use crate::{plugin_manager, plugins};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
#[cfg(not(debug_assertions))]
use tauri::Manager;

static INSTALL: Mutex<()> = Mutex::new(());
const EXTENSION: &str = "beaconhop.beaconhop-tabs";
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EdgeListing {
    extension_id: Option<String>,
    store_url: Option<String>,
}
impl EdgeListing {
    fn validate(&self) -> Result<(), String> {
        match (&self.extension_id, &self.store_url) {
            (None, None) => Ok(()),
            (Some(id), Some(link)) => {
                let url = reqwest::Url::parse(link).map_err(|_| "Invalid Edge store URL")?;
                if !valid_extension_id(id)
                    || url.scheme() != "https"
                    || url.host_str() != Some("microsoftedge.microsoft.com")
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || url.port().is_some()
                    || url.query().is_some()
                    || url.fragment().is_some()
                    || !url.path().starts_with("/addons/detail/")
                    || url.path().rsplit('/').next() != Some(id)
                {
                    return Err("Invalid official Edge listing".into());
                }
                Ok(())
            }
            _ => Err("Incomplete Edge store listing".into()),
        }
    }
}
fn listing() -> Result<EdgeListing, String> {
    #[derive(Deserialize)]
    struct Distribution {
        edge: EdgeListing,
    }
    let config: Distribution =
        serde_json::from_str(include_str!("../../plugins/distribution.json"))
            .map_err(|e| e.to_string())?;
    config.edge.validate()?;
    Ok(config.edge)
}
fn valid_extension_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
}
fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}
#[derive(Clone)]
struct CodeApp {
    executable: PathBuf,
    cli: PathBuf,
    insiders: bool,
    #[cfg(test)]
    isolation: Option<PathBuf>,
}
fn code_app() -> Option<CodeApp> {
    let mut bases = Vec::new();
    #[cfg(target_os = "macos")]
    {
        for insiders in [false, true] {
            let name = if insiders {
                "Visual Studio Code - Insiders.app"
            } else {
                "Visual Studio Code.app"
            };
            for base in [
                Some(PathBuf::from("/Applications")),
                home().map(|h| h.join("Applications")),
            ]
            .into_iter()
            .flatten()
            {
                let app = base.join(name).join("Contents");
                for executable in ["Code", "Electron"] {
                    bases.push(CodeApp {
                        executable: app.join("MacOS").join(executable),
                        cli: app.join("Resources/app/out/cli.js"),
                        insiders,
                        #[cfg(test)]
                        isolation: None,
                    });
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        for insiders in [false, true] {
            let folder = if insiders {
                "Microsoft VS Code Insiders"
            } else {
                "Microsoft VS Code"
            };
            for base in [
                std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Programs")),
                std::env::var_os("ProgramFiles").map(PathBuf::from),
                std::env::var_os("ProgramFiles(x86)").map(PathBuf::from),
            ]
            .into_iter()
            .flatten()
            {
                let app = base.join(folder);
                bases.push(CodeApp {
                    executable: app.join(if insiders {
                        "Code - Insiders.exe"
                    } else {
                        "Code.exe"
                    }),
                    cli: app.join("resources/app/out/cli.js"),
                    insiders,
                    #[cfg(test)]
                    isolation: None,
                });
            }
        }
    }
    bases
        .into_iter()
        .find(|p| p.executable.is_file() && p.cli.is_file())
}
fn edge_app() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    {
        for base in [
            Some(PathBuf::from("/Applications")),
            home().map(|h| h.join("Applications")),
        ]
        .into_iter()
        .flatten()
        {
            candidates.push(base.join("Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
        }
    }
    #[cfg(target_os = "windows")]
    for base in ["LOCALAPPDATA", "ProgramFiles(x86)", "ProgramFiles"]
        .into_iter()
        .filter_map(std::env::var_os)
    {
        candidates.push(PathBuf::from(base).join("Microsoft/Edge/Application/msedge.exe"));
    }
    candidates.into_iter().find(|p| p.is_file())
}
fn installed_code_version(app: &CodeApp) -> Option<String> {
    let root = home()?
        .join(if app.insiders {
            ".vscode-insiders"
        } else {
            ".vscode"
        })
        .join("extensions");
    let entries: Value =
        serde_json::from_slice(&fs::read(root.join("extensions.json")).ok()?).ok()?;
    entries
        .as_array()?
        .iter()
        .filter(|e| e["identifier"]["id"] == EXTENSION)
        .filter_map(|e| {
            e["version"]
                .as_str()
                .and_then(|v| semver::Version::parse(v).ok())
        })
        .max()
        .map(|v| v.to_string())
}
fn payload_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/plugins"))
    }
    #[cfg(not(debug_assertions))]
    {
        Ok(app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("plugins"))
    }
}
fn bundled_version() -> String {
    let manifest: Value =
        serde_json::from_str(include_str!("../../plugins/vscode/package.json")).unwrap();
    manifest["version"].as_str().unwrap().to_owned()
}
fn verified_payload(directory: &Path) -> Result<PathBuf, String> {
    let manifest: Value = serde_json::from_slice(&fs::read(directory.join("payload.json"))
        .map_err(|_| "The bundled extension is missing. Reinstall BeaconHop / 安装包缺少扩展，请重新安装 BeaconHop")?).map_err(|e| e.to_string())?;
    let vsix = directory.join("beaconhop-tabs.vsix");
    let bytes = fs::read(&vsix).map_err(|e| e.to_string())?;
    if manifest["vscode"]["version"] != bundled_version()
        || manifest["vscode"]["sha256"] != format!("{:x}", Sha256::digest(bytes))
    {
        return Err("The bundled extension failed verification. Reinstall BeaconHop / 扩展校验失败，请重新安装 BeaconHop".into());
    }
    Ok(vsix)
}
fn existing_edge_ids() -> Vec<String> {
    let Ok(directory) = plugin_manager::browser_directory("edge") else {
        return vec![];
    };
    let Ok(bytes) = fs::read(directory.join("com.beaconhop.tabs.json")) else {
        return vec![];
    };
    if bytes.len() > 64 * 1024 {
        return vec![];
    }
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return vec![];
    };
    if value["name"] != "com.beaconhop.tabs" {
        return vec![];
    }
    value["allowed_origins"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|origin| {
            let id = origin
                .as_str()?
                .strip_prefix("chrome-extension://")?
                .strip_suffix('/')?;
            valid_extension_id(id).then(|| id.to_owned())
        })
        .take(32)
        .collect()
}
pub fn status() -> Result<Value, String> {
    let edge = listing()?;
    let code = code_app();
    let live = plugins::discover();
    // Filter by application; another browser must not make the Edge card green.
    let edge_instances = live
        .iter()
        .filter(|p| {
            p.provider == "browser"
                && p.app_ids
                    .iter()
                    .any(|id| ["com.microsoft.edgemac", "msedge.exe"].contains(&id.as_str()))
        })
        .count();
    let code_ids = if code.as_ref().is_some_and(|app| app.insiders) {
        ["com.microsoft.VSCodeInsiders", "code - insiders.exe"]
    } else {
        ["com.microsoft.VSCode", "code.exe"]
    };
    let code_instances = live
        .iter()
        .filter(|p| {
            p.provider == "vscode" && p.app_ids.iter().any(|id| code_ids.contains(&id.as_str()))
        })
        .count();
    Ok(json!({
        "edge": {"detected":edge_app().is_some(), "storeAvailable":edge.extension_id.is_some(), "canRepair":!existing_edge_ids().is_empty(), "instances":edge_instances},
        "vscode": {"detected":code.is_some(), "name":if code.as_ref().is_some_and(|c|c.insiders){"VS Code Insiders"}else{"VS Code"}, "installedVersion":code.as_ref().and_then(installed_code_version), "bundledVersion":bundled_version(), "instances":code_instances}
    }))
}
#[tauri::command]
pub async fn get_plugin_installation() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(status)
        .await
        .map_err(|e| e.to_string())?
}
fn hide_console(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = command;
}
fn code_command(app: &CodeApp) -> Command {
    let mut command = Command::new(&app.executable);
    command
        .arg(&app.cli)
        .env("ELECTRON_RUN_AS_NODE", "1")
        .env_remove("VSCODE_IPC_HOOK_CLI");
    #[cfg(test)]
    if let Some(root) = &app.isolation {
        command
            .arg("--user-data-dir")
            .arg(root.join("user"))
            .arg("--extensions-dir")
            .arg(root.join("extensions"));
    }
    hide_console(&mut command);
    command
}
fn run_cli(command: &mut Command, timeout: Duration) -> Result<String, String> {
    let path = plugins::directory()?.join(format!(".install-{}.log", uuid::Uuid::new_v4()));
    plugins::private_write(&path, b"")?;
    let result = (|| {
        let output = fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        command
            .stdin(Stdio::null())
            .stdout(output.try_clone().map_err(|e| e.to_string())?)
            .stderr(output);
        let mut child = command.spawn().map_err(|e| {
            format!("Could not start VS Code installer / 无法启动 VS Code 安装器: {e}")
        })?;
        let deadline = Instant::now() + timeout;
        let exit = loop {
            match child.try_wait() {
                Ok(Some(exit)) => break exit,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                result => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(if let Err(e) = result {
                        e.to_string()
                    } else {
                        "VS Code installation timed out. Retry from Application plugins / VS Code 安装超时，请在应用插件中重试".into()
                    });
                }
            }
        };
        let mut bytes = Vec::new();
        fs::File::open(&path)
            .map_err(|e| e.to_string())?
            .take(64 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes).into_owned();
        if !exit.success() {
            return Err(format!(
                "VS Code installation failed / VS Code 安装失败: {}",
                text.chars().take(2000).collect::<String>()
            ));
        }
        Ok(text)
    })();
    let _ = fs::remove_file(path);
    result
}
fn version_from_cli(text: &str) -> Option<semver::Version> {
    text.lines().find_map(|line| {
        line.trim()
            .strip_prefix(&format!("{EXTENSION}@"))
            .and_then(|v| semver::Version::parse(v).ok())
    })
}
fn install_code(directory: &Path, app: &CodeApp) -> Result<Value, String> {
    let vsix = verified_payload(directory)?;
    let expected = semver::Version::parse(&bundled_version()).map_err(|e| e.to_string())?;
    let installed = run_cli(
        code_command(app).args(["--list-extensions", "--show-versions"]),
        Duration::from_secs(30),
    )?;
    // Preserve a newer version. Explicitly installed bundled VSIX needs no Marketplace access.
    if !version_from_cli(&installed).is_some_and(|v| v >= expected) {
        run_cli(
            code_command(app)
                .arg("--install-extension")
                .arg(vsix)
                .arg("--force"),
            Duration::from_secs(120),
        )?;
    }
    let verified = run_cli(
        code_command(app).args(["--list-extensions", "--show-versions"]),
        Duration::from_secs(30),
    )?;
    let version = version_from_cli(&verified)
        .filter(|v| v >= &expected)
        .ok_or("VS Code did not confirm installation / VS Code 未确认扩展安装成功")?;
    Ok(json!({"state":"installed", "version":version.to_string()}))
}
fn open_edge(target: &Path, url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("/usr/bin/open");
        c.arg("-a")
            .arg(
                target
                    .ancestors()
                    .nth(3)
                    .ok_or("Invalid Edge application path")?,
            )
            .arg(url);
        c
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = {
        let mut c = Command::new(target);
        c.arg(url);
        c
    };
    hide_console(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not open Edge / 无法打开 Edge: {e}"))?;
    // Edge may keep the process alive until the user quits the browser.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
fn install_edge(repair: bool) -> Result<Value, String> {
    let app = edge_app().ok_or("Microsoft Edge was not found / 未检测到 Microsoft Edge")?;
    let config = listing()?;
    let mut ids = existing_edge_ids();
    if let Some(id) = &config.extension_id {
        ids.push(id.clone());
    }
    if !repair && config.store_url.is_none() {
        return Err("The Edge extension has not been published yet / Edge 扩展尚未上架".into());
    }
    if ids.is_empty() {
        return Err("No installed Edge connection to repair / 未找到可修复的 Edge 连接".into());
    }
    for id in ids {
        plugin_manager::register_browser("edge", &id)?;
    }
    if !repair {
        open_edge(&app, config.store_url.as_deref().unwrap())?;
    }
    Ok(json!({"state":if repair {"waiting-connection"} else {"waiting-browser"}}))
}
#[tauri::command]
pub async fn install_application_plugin(
    app: tauri::AppHandle,
    target: String,
) -> Result<Value, String> {
    let directory = payload_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = INSTALL
            .try_lock()
            .map_err(|_| "An installation is already running / 正在安装，请稍候")?;
        match target.as_str() {
            "vscode" => install_code(
                &directory,
                &code_app().ok_or("VS Code was not found / 未检测到 VS Code")?,
            ),
            "edge" => install_edge(false),
            "edge-repair" => install_edge(true),
            _ => Err("Unknown application installer".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Refresh only previously authorized host registrations when BH moves/updates.
#[cfg(not(debug_assertions))]
pub fn repair_registered_hosts() {
    for id in existing_edge_ids() {
        if let Err(error) = plugin_manager::register_browser("edge", &id) {
            log::warn!("Edge connection repair: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires local VS Code and a host-heavy lease; installs into an isolated temporary profile"]
    fn real_vscode_install_is_verified_and_repeatable() {
        let root = std::env::temp_dir().join(format!("bh-vscode-install-{}", uuid::Uuid::new_v4()));
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(root.clone());
        let mut app = code_app().expect("VS Code is required");
        app.isolation = Some(root);
        let payload = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/plugins");
        let first = install_code(&payload, &app).unwrap();
        assert_eq!(first["state"], "installed");
        assert_eq!(install_code(&payload, &app).unwrap(), first);
    }
    #[test]
    fn listing_rejects_untrusted_or_mismatched_origins() {
        let id = "a".repeat(32);
        for link in [
            format!("https://evil.test/addons/detail/{id}"),
            format!("http://microsoftedge.microsoft.com/addons/detail/{id}"),
            format!(
                "https://microsoftedge.microsoft.com/addons/detail/{}",
                "b".repeat(32)
            ),
            format!("https://microsoftedge.microsoft.com/addons/detail/{id}?redirect=elsewhere"),
        ] {
            assert!(EdgeListing {
                extension_id: Some(id.clone()),
                store_url: Some(link)
            }
            .validate()
            .is_err());
        }
        assert!(EdgeListing {
            extension_id: Some(id.clone()),
            store_url: Some(format!(
                "https://microsoftedge.microsoft.com/addons/detail/beaconhop-tabs/{id}"
            ))
        }
        .validate()
        .is_ok());
        assert!(listing().is_ok());
    }
    #[test]
    fn installation_confirmation_requires_exact_extension_and_semver() {
        assert_eq!(
            version_from_cli("noise\nbeaconhop.beaconhop-tabs@0.2.0\n"),
            Some(semver::Version::new(0, 2, 0))
        );
        assert!(version_from_cli("other.beaconhop-tabs@0.2.0").is_none());
        assert!(version_from_cli("beaconhop.beaconhop-tabs@invalid").is_none());
    }
    #[test]
    fn modified_payload_is_rejected_before_execution() {
        let root = std::env::temp_dir().join(format!("bh-payload-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("payload.json"),
            json!({"vscode":{"version":bundled_version(),"sha256":"incorrect"}}).to_string(),
        )
        .unwrap();
        fs::write(root.join("beaconhop-tabs.vsix"), b"corrupt").unwrap();
        assert!(verified_payload(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
