//! Local plugin metadata, user opt-out and browser host registration.
//! Registering a manifest never executes code; application adapters own their lifecycle.
use crate::plugins::{self, Endpoint};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
static WRITES: Mutex<()> = Mutex::new(());
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub protocol: u8,
    pub id: String,
    pub name: String,
    pub version: String,
    pub app_ids: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
}
impl Manifest {
    pub fn validate(&self) -> Result<(), String> {
        if self.protocol != 1
            || !valid_id(&self.id)
            || self.name.trim().is_empty()
            || self.name.len() > 400
            || self.version.len() > 100
            || semver::Version::parse(&self.version).is_err()
            || self.app_ids.is_empty()
            || self.app_ids.len() > 16
            || self
                .app_ids
                .iter()
                .any(|id| id.trim().is_empty() || id.len() > 800)
            || self.capabilities.len() > 16
            || self.capabilities.iter().any(|c| c != "thumbnails")
            || self.description.len() > 2000
        {
            return Err("Invalid plugin manifest / 插件信息格式不正确".into());
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > 8192 {
            return Err("Plugin manifest exceeds 8 KiB".into());
        }
        if let Some(homepage) = &self.homepage {
            let url = reqwest::Url::parse(homepage).map_err(|_| "Invalid plugin homepage")?;
            if homepage.len() > 2048
                || url.scheme() != "https"
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Plugin homepage must use HTTPS".into());
            }
        }
        Ok(())
    }
}
#[derive(Default, Deserialize, Serialize)]
struct Preferences {
    #[serde(default)]
    disabled: BTreeSet<String>,
}
fn preferences(root: &Path) -> Result<Preferences, String> {
    let path = root.join("preferences.json");
    match fs::read(&path) {
        Ok(data) if data.len() <= 64 * 1024 => serde_json::from_slice(&data).map_err(|_| "Plugin preferences are invalid. Restore preferences.json before changing plugin connections.".into()),
        Ok(_) => Err("Plugin preferences are too large".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(error) => Err(format!("Cannot read plugin preferences: {error}")),
    }
}
pub fn disabled() -> Result<BTreeSet<String>, String> {
    Ok(preferences(&plugins::directory()?)?.disabled)
}
pub fn enabled(id: &str) -> bool {
    disabled().is_ok_and(|ids| !ids.contains(id))
}
fn set_enabled(root: &Path, provider: &str, enabled: bool) -> Result<(), String> {
    if !valid_id(provider) {
        return Err("Invalid plugin ID".into());
    }
    let mut settings = preferences(root)?;
    if enabled {
        settings.disabled.remove(provider);
    } else {
        settings.disabled.insert(provider.to_owned());
    }
    plugins::private_write(
        &root.join("preferences.json"),
        &serde_json::to_vec(&settings).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
pub fn set_plugin_enabled(provider: String, enabled: bool) -> Result<(), String> {
    let _guard = WRITES.lock().unwrap();
    set_enabled(&plugins::directory()?, &provider, enabled)
}
fn register(root: &Path, manifest: Manifest) -> Result<Manifest, String> {
    manifest.validate()?;
    plugins::private_write(
        &root.join("registry").join(format!("{}.json", manifest.id)),
        &serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
    )?;
    Ok(manifest)
}
#[tauri::command]
pub fn register_plugin_manifest(manifest: Manifest) -> Result<Manifest, String> {
    let _guard = WRITES.lock().unwrap();
    register(&plugins::directory()?, manifest)
}
#[tauri::command]
pub fn forget_plugin(provider: String) -> Result<(), String> {
    if !valid_id(&provider) || ["browser", "vscode", "codex"].contains(&provider.as_str()) {
        return Err("This plugin record cannot be removed".into());
    }
    if plugins::discover().iter().any(|p| p.provider == provider) {
        return Err("Disconnect this application's adapter before removing its record".into());
    }
    let _guard = WRITES.lock().unwrap();
    match fs::remove_file(
        plugins::directory()?
            .join("registry")
            .join(format!("{provider}.json")),
    ) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
    // Keep any opt-out: reconnecting/reimporting a removed plugin must not re-enable it.
}
fn builtins() -> Vec<Manifest> {
    [
        (
            "browser",
            "Browser",
            "Chrome / Edge",
            vec![
                "com.microsoft.edgemac",
                "msedge.exe",
                "com.google.Chrome",
                "chrome.exe",
            ],
        ),
        (
            "vscode",
            "VS Code",
            "Text, diff and notebook editors",
            vec!["com.microsoft.VSCode", "code.exe"],
        ),
        (
            "codex",
            "Codex",
            "Recent local sessions on macOS",
            vec!["com.openai.codex"],
        ),
    ]
    .into_iter()
    .map(|(id, name, description, apps)| Manifest {
        protocol: 1,
        id: id.into(),
        name: name.into(),
        version: String::new(),
        description: description.into(),
        app_ids: apps.into_iter().map(str::to_owned).collect(),
        capabilities: vec![],
        homepage: None,
    })
    .collect()
}
fn entries(root: &Path, live: &[Endpoint], codex: bool) -> Result<(Vec<Value>, usize), String> {
    let disabled = preferences(root)?.disabled;
    let mut manifests: BTreeMap<_, _> = builtins()
        .into_iter()
        .map(|m| (m.id.clone(), (m, false)))
        .collect();
    let mut invalid = 0;
    if let Ok(files) = fs::read_dir(root.join("registry")) {
        for file in files.flatten().take(256) {
            let path = file.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let parsed = (|| {
                let metadata = fs::symlink_metadata(&path).ok()?;
                if !metadata.is_file() || metadata.len() > 8192 {
                    return None;
                }
                let manifest: Manifest = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
                manifest.validate().ok()?;
                if path.file_stem()?.to_str()? != manifest.id {
                    return None;
                }
                Some(manifest)
            })();
            if let Some(manifest) = parsed {
                manifests.insert(manifest.id.clone(), (manifest, true));
            } else {
                invalid += 1;
            }
        }
    }
    for endpoint in live {
        manifests
            .entry(endpoint.provider.clone())
            .or_insert_with(|| {
                (
                    Manifest {
                        protocol: 1,
                        id: endpoint.provider.clone(),
                        name: endpoint
                            .name
                            .clone()
                            .filter(|s| !s.is_empty())
                            .unwrap_or_else(|| endpoint.provider.clone()),
                        version: String::new(),
                        description: String::new(),
                        app_ids: endpoint.app_ids.clone(),
                        capabilities: endpoint.capabilities.clone(),
                        homepage: None,
                    },
                    false,
                )
            });
    }
    let rows = manifests.into_iter().map(|(id,(manifest,registered))| {
        let endpoints: Vec<_> = live.iter().filter(|p| p.provider == id).collect();
        let versions: BTreeSet<_> = endpoints.iter().filter_map(|p|p.version.clone()).chain((!manifest.version.is_empty()).then_some(manifest.version.clone())).collect();
        let capabilities: BTreeSet<_> = endpoints.iter().flat_map(|p|p.capabilities.clone()).chain(manifest.capabilities.clone()).collect();
        let apps: BTreeSet<_> = endpoints.iter().flat_map(|p|p.app_ids.clone()).chain(manifest.app_ids.clone()).collect();
        json!({"provider":id,"name":manifest.name,"description":manifest.description,"versions":versions,"appIds":apps,"capabilities":capabilities,
            "enabled":!disabled.contains(&id),"connected":!endpoints.is_empty() || (id=="codex" && codex),"instances":endpoints.len(),"registered":registered,
            "builtin":(["browser","vscode","codex"].contains(&id.as_str()))})
    }).collect();
    Ok((rows, invalid))
}
#[tauri::command]
pub fn get_plugin_status() -> Result<Value, String> {
    let root = plugins::directory()?;
    let live = plugins::discover();
    let codex = crate::codex_plugin::available();
    let (entries, invalid) = entries(&root, &live, codex)?;
    let plugins: Vec<_> = live
        .iter()
        .map(|p| json!({"provider":p.provider,"instance":p.instance,"appIds":p.app_ids}))
        .collect();
    Ok(
        json!({"plugins":plugins,"entries":entries,"codex":codex,"directory":root,"invalidManifests":invalid}),
    )
}
pub(crate) fn browser_directory(browser: &str) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let folder = match browser {
            "chrome" => "Google/Chrome",
            "edge" => "Microsoft Edge",
            "chromium" => "Chromium",
            "brave" => "BraveSoftware/Brave-Browser",
            _ => return Err("Unsupported browser".into()),
        };
        let home = std::env::var_os("HOME").ok_or("Cannot find the home directory")?;
        Ok(PathBuf::from(home)
            .join("Library/Application Support")
            .join(folder)
            .join("NativeMessagingHosts"))
    }
    #[cfg(target_os = "windows")]
    {
        if !["chrome", "edge", "chromium", "brave"].contains(&browser) {
            return Err("Unsupported browser".into());
        }
        Ok(
            PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("Cannot find LocalAppData")?)
                .join("BeaconHop/NativeMessagingHosts")
                .join(browser),
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = browser;
        Err("Browser installation supports macOS and Windows".into())
    }
}
fn browser_manifest(
    previous: Option<Value>,
    extension_id: &str,
    executable: &Path,
) -> Result<Value, String> {
    if extension_id.len() != 32 || !extension_id.bytes().all(|b| (b'a'..=b'p').contains(&b)) {
        return Err("Copy the 32-letter extension ID from the browser's extension page / 请填写浏览器扩展页面里的 32 位扩展 ID".into());
    }
    if !executable.is_absolute() {
        return Err("BeaconHop executable path must be absolute".into());
    }
    let mut origins = BTreeSet::new();
    if let Some(previous) = previous {
        if previous["name"] != "com.beaconhop.tabs" {
            return Err("An unrelated native host manifest already exists".into());
        }
        let existing = previous["allowed_origins"]
            .as_array()
            .ok_or("Existing native host manifest is invalid")?;
        for origin in existing {
            origins.insert(
                origin
                    .as_str()
                    .ok_or("Invalid existing extension origin")?
                    .to_owned(),
            );
        }
    }
    origins.insert(format!("chrome-extension://{extension_id}/"));
    Ok(
        json!({"name":"com.beaconhop.tabs","description":"BeaconHop browser tabs","path":executable,"type":"stdio","allowed_origins":origins}),
    )
}
pub fn register_browser(browser: &str, extension_id: &str) -> Result<String, String> {
    let _guard = WRITES.lock().unwrap();
    let directory = browser_directory(browser)?;
    let filename = directory.join("com.beaconhop.tabs.json");
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let previous = match fs::read(&filename) {
        Ok(data) => Some(
            serde_json::from_slice(&data)
                .map_err(|_| "Existing native host manifest is invalid")?,
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    let manifest = browser_manifest(previous, extension_id, &executable)?;
    // Do not chmod the browser-owned directory. Only our file is private/atomic.
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let pending = directory.join(format!(".beaconhop-{}.pending", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new();
    file.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        file.mode(0o600);
    }
    use std::io::Write;
    let result = (|| {
        file.open(&pending)?
            .write_all(serde_json::to_string_pretty(&manifest).unwrap().as_bytes())?;
        fs::rename(&pending, &filename)
    })();
    let _ = fs::remove_file(&pending);
    result.map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        let vendor = match browser {
            "edge" => "Microsoft\\Edge",
            "chrome" => "Google\\Chrome",
            "chromium" => "Chromium",
            _ => "BraveSoftware\\Brave-Browser",
        };
        let key = format!("HKCU\\Software\\{vendor}\\NativeMessagingHosts\\com.beaconhop.tabs");
        let result = std::process::Command::new("reg.exe")
            .args(["add", &key, "/ve", "/t", "REG_SZ", "/d"])
            .arg(&filename)
            .arg("/f")
            .output()
            .map_err(|e| e.to_string())?;
        if !result.status.success() {
            return Err("Could not register the per-user browser host".into());
        }
    }
    Ok(filename.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn register_browser_host(browser: String, extension_id: String) -> Result<String, String> {
    register_browser(&browser, &extension_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("beaconhop-plugins-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn manifest() -> Manifest {
        serde_json::from_value(json!({"protocol":1,"id":"example.notes","name":"Notes","version":"1.2.3","appIds":["com.example.notes"]})).unwrap()
    }
    #[test]
    fn registered_offline_plugins_and_opt_out_survive_reload() {
        let root = temp();
        register(&root, manifest()).unwrap();
        set_enabled(&root, "example.notes", false).unwrap();
        let (rows, invalid) = entries(&root, &[], false).unwrap();
        assert_eq!(invalid, 0);
        let row = rows
            .iter()
            .find(|r| r["provider"] == "example.notes")
            .unwrap();
        assert_eq!(row["registered"], true);
        assert_eq!(row["connected"], false);
        assert_eq!(row["enabled"], false);
        register(&root, manifest()).unwrap();
        assert!(preferences(&root)
            .unwrap()
            .disabled
            .contains("example.notes"));
        set_enabled(&root, "example.notes", true).unwrap();
        assert!(preferences(&root).unwrap().disabled.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_manifest_ids_versions_and_broken_preferences_are_not_accepted() {
        let root = temp();
        let mut m = manifest();
        m.id = "../escape".into();
        assert!(register(&root, m).is_err());
        let mut m = manifest();
        m.version = "latest".into();
        assert!(register(&root, m).is_err());
        fs::write(root.join("preferences.json"), "broken").unwrap();
        assert!(entries(&root, &[], false).is_err());
        assert!(set_enabled(&root, "example", true).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn browser_registration_preserves_other_extension_ids_and_rejects_injection() {
        let executable = std::env::current_exe().unwrap();
        let a = "a".repeat(32);
        let b = "b".repeat(32);
        let first = browser_manifest(None, &a, &executable).unwrap();
        let second = browser_manifest(Some(first), &b, &executable).unwrap();
        assert_eq!(second["allowed_origins"].as_array().unwrap().len(), 2);
        assert_eq!(
            browser_manifest(Some(second.clone()), &a, &executable).unwrap(),
            second
        );
        assert!(browser_manifest(None, "x; rm", &executable).is_err());
        assert!(browser_manifest(Some(json!({"name":"unrelated"})), &a, &executable).is_err());
    }
}
