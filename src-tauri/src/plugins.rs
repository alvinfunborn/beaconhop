//! Small local plugin protocol. No UI work or socket I/O runs in the keyboard hook.
use crate::model::{ContentPresentation, ContentRef, Destination};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    time::Duration,
};

pub const MAX_MESSAGE: usize = 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub protocol: u8,
    pub provider: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    pub instance: String,
    pub app_ids: Vec<String>,
    pub port: u16,
    pub token: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}
#[derive(Deserialize)]
struct Inventory {
    contexts: Vec<Context>,
}
#[derive(Deserialize)]
struct Context {
    id: String,
    focused: bool,
    #[serde(default)]
    presentation: Option<ContentPresentation>,
    items: Vec<Item>,
}
#[derive(Deserialize)]
struct Item {
    id: String,
    title: String,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    active: bool,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    preview: bool,
}

pub fn directory() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("BEACONHOP_PLUGIN_DIR") {
        return Ok(path.into());
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(|home| PathBuf::from(home).join(".beaconhop/plugins"))
        .ok_or_else(|| "Cannot locate the plugin directory".into())
}
pub fn private_write(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid plugin path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let pending = path.with_extension(format!("{}.pending", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(&pending)
        .and_then(|mut f| f.write_all(data))
        .map_err(|e| e.to_string())?;
    let result = fs::rename(&pending, path).map_err(|e| e.to_string());
    let _ = fs::remove_file(&pending);
    result
}
pub fn discover() -> Vec<Endpoint> {
    let Ok(dir) = directory().and_then(|d| fs::read_dir(d).map_err(|e| e.to_string())) else {
        return vec![];
    };
    dir.flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()?.to_str()? != "json" {
                return None;
            }
            let metadata = fs::symlink_metadata(&path).ok()?;
            if !metadata.is_file()
                || metadata.len() > 8192
                || metadata.modified().ok()?.elapsed().ok()? > Duration::from_secs(20)
            {
                return None;
            }
            let endpoint: Endpoint = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
            (endpoint.protocol == 1
                && endpoint.port != 0
                && endpoint.token.len() >= 32
                && !endpoint.instance.is_empty()
                && endpoint.instance.len() <= 100
                && crate::plugin_manager::valid_id(&endpoint.provider)
                && endpoint.name.as_ref().is_none_or(|s| s.len() <= 400)
                && endpoint.version.as_ref().is_none_or(|s| s.len() <= 100)
                && endpoint.app_ids.len() <= 16)
                .then_some(endpoint)
        })
        // Crashed hosts can leave stale files; they must not crowd out live endpoints.
        .take(128)
        .collect()
}
pub fn app_key(app_id: &str) -> String {
    if app_id.contains('\\') || app_id.contains('/') {
        app_id
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(app_id)
            .to_lowercase()
    } else {
        app_id.to_lowercase()
    }
}
fn discover_enabled() -> Vec<Endpoint> {
    let Ok(disabled) = crate::plugin_manager::disabled() else {
        return vec![];
    };
    discover()
        .into_iter()
        .filter(|e| !disabled.contains(&e.provider))
        .collect()
}
pub fn supported_apps() -> HashSet<String> {
    let mut result: HashSet<_> = discover_enabled()
        .into_iter()
        .flat_map(|e| e.app_ids)
        .map(|id| app_key(&id))
        .collect();
    if crate::plugin_manager::enabled("codex") && crate::codex_plugin::available() {
        result.insert("com.openai.codex".into());
    }
    result
}
pub fn read_line(reader: &mut impl BufRead) -> Result<Value, String> {
    let mut line = Vec::new();
    reader
        .take((MAX_MESSAGE + 1) as u64)
        .read_until(b'\n', &mut line)
        .map_err(|e| e.to_string())?;
    if line.len() > MAX_MESSAGE || line.last() != Some(&b'\n') {
        return Err("Invalid or oversized plugin message".into());
    }
    serde_json::from_slice(&line).map_err(|_| "Invalid plugin JSON".into())
}
pub fn rpc(endpoint: &Endpoint, method: &str, params: Value) -> Result<Value, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    let mut socket = TcpStream::connect_timeout(&address, Duration::from_millis(500))
        .map_err(|_| "Plugin disconnected. Reconnect it and try again.".to_string())?;
    socket
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| e.to_string())?;
    socket
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let request =
        json!({"protocol":1,"id":id,"token":endpoint.token,"method":method,"params":params});
    writeln!(socket, "{request}").map_err(|e| e.to_string())?;
    let reply = read_line(&mut BufReader::new(socket))?;
    if reply["id"] != id {
        return Err("Plugin response does not match this request".into());
    }
    if let Some(error) = reply["error"].as_str() {
        return Err(error.chars().take(300).collect());
    }
    reply
        .get("result")
        .cloned()
        .ok_or_else(|| "Plugin returned no result".into())
}
#[derive(Clone, Debug)]
pub struct SearchContext {
    pub(crate) endpoint: Endpoint,
    pub(crate) context: String,
    pub(crate) parent: Destination,
}
impl SearchContext {
    pub fn search(&self, query: &str) -> Result<Vec<Destination>, String> {
        if !crate::plugin_manager::enabled(&self.endpoint.provider) {
            return Err("Plugin is disabled".into());
        }
        let reply = rpc(
            &self.endpoint,
            "search",
            json!({"context": self.context, "query": query}),
        )?;
        let mut inventory: Inventory =
            serde_json::from_value(reply).map_err(|_| "Invalid search inventory")?;
        if inventory.contexts.len() != 1 || inventory.contexts[0].id != self.context {
            return Err("Search returned another context".into());
        }
        destinations(&self.parent, &self.endpoint, inventory.contexts.remove(0))
    }
}
pub fn list(
    parent: &Destination,
    codex_home: &str,
) -> Result<(Vec<Destination>, Option<SearchContext>), String> {
    if parent.app_id == "com.openai.codex" {
        if !crate::plugin_manager::enabled("codex") {
            return Err("Codex plugin is disabled".into());
        }
        return crate::codex_plugin::list(parent, codex_home).map(|items| (items, None));
    }
    let endpoints: Vec<_> = discover_enabled()
        .into_iter()
        .filter(|e| {
            e.app_ids
                .iter()
                .any(|id| app_key(id) == app_key(&parent.app_id))
        })
        .take(16)
        .collect();
    if endpoints.is_empty() {
        return Err("Connect a plugin for this application first / 请先连接应用插件".into());
    }
    // Refresh focus before showing the panel. Two focused contexts are ambiguous, never guess.
    let replies = std::thread::scope(|scope| {
        let jobs: Vec<_> = endpoints
            .into_iter()
            .map(|e| {
                scope.spawn(move || {
                    let result = rpc(&e, "list", json!({})).and_then(|v| {
                        serde_json::from_value::<Inventory>(v)
                            .map_err(|_| "Invalid plugin inventory".into())
                    });
                    (e, result)
                })
            })
            .collect();
        jobs.into_iter()
            .filter_map(|j| j.join().ok())
            .collect::<Vec<_>>()
    });
    let mut focused = Vec::new();
    let mut error = None;
    for (endpoint, reply) in replies {
        match reply {
            Ok(inventory) => {
                if inventory.contexts.len() > 256 {
                    return Err("Plugin returned too many contexts".into());
                }
                for context in inventory.contexts.into_iter().filter(|c| c.focused) {
                    focused.push((endpoint.clone(), context));
                }
            }
            Err(e) => error = Some(e),
        }
    }
    if focused.len() != 1 {
        return Err(error.unwrap_or_else(|| "Cannot identify one focused plugin window. Focus the application and retry / 请聚焦应用后重试".into()));
    }
    let (endpoint, context) = focused.pop().unwrap();
    let search = endpoint
        .capabilities
        .iter()
        .any(|c| c == "search")
        .then(|| SearchContext {
            endpoint: endpoint.clone(),
            context: context.id.clone(),
            parent: parent.clone(),
        });
    destinations(parent, &endpoint, context).map(|items| (items, search))
}
fn destinations(
    parent: &Destination,
    endpoint: &Endpoint,
    context: Context,
) -> Result<Vec<Destination>, String> {
    if context.id.is_empty() || context.id.len() > 512 || context.items.len() > 2000 {
        return Err("Invalid plugin context".into());
    }
    let mut ids = HashSet::new();
    // Old adapters select a sensible default from their image capability.
    // Explicit text remains text even if that adapter also offers images.
    let presentation = context.presentation.unwrap_or_else(|| {
        if endpoint.capabilities.iter().any(|c| c == "thumbnails") {
            ContentPresentation::Thumbnails
        } else {
            ContentPresentation::Text
        }
    });
    context
        .items
        .into_iter()
        .map(|item| {
            if item.id.is_empty()
                || item.id.len() > 2048
                || item.title.len() > 8192
                || item.subtitle.len() > 8192
                || item.description.len() > 8192
                || !ids.insert(item.id.clone())
            {
                return Err("Invalid or duplicate plugin target".into());
            }
            let mut target = parent.clone();
            target.id = serde_json::to_string(&(
                &endpoint.provider,
                &endpoint.instance,
                &context.id,
                &item.id,
            ))
            .unwrap();
            target.title = item.title;
            // Accept only small local images from any adapter. A browser tab without a
            // favicon stays empty instead of showing the browser application's icon.
            let icon = item
                .icon
                .filter(|icon| icon.len() <= 8192 && icon.starts_with("data:image/png;base64,"));
            if icon.is_some() || endpoint.provider == "browser" {
                target.icon = icon;
            }
            target.content = Some(ContentRef {
                provider: endpoint.provider.clone(),
                instance: endpoint.instance.clone(),
                context: context.id.clone(),
                item: item.id,
                parent_id: parent.id.clone(),
                subtitle: item.subtitle,
                active: item.active,
                preview: presentation == ContentPresentation::Thumbnails
                    && item.preview
                    && endpoint.capabilities.iter().any(|c| c == "thumbnails"),
                presentation,
                description: item.description,
            });
            Ok(target)
        })
        .collect()
}
/// Read optional plugin caches separately from inventory/activation. Never capture here.
pub fn thumbnails(targets: &[Destination]) -> HashMap<String, String> {
    let mut images = HashMap::new();
    let endpoints = discover_enabled();
    // One UI request is deliberately small, keeping native frames below 1 MiB.
    for target in targets.iter().take(8) {
        let Some(content) = &target.content else {
            continue;
        };
        if content.presentation != ContentPresentation::Thumbnails {
            continue;
        }
        let Some(endpoint) = endpoints.iter().find(|e| {
            e.provider == content.provider
                && e.instance == content.instance
                && e.capabilities.iter().any(|c| c == "thumbnails")
        }) else {
            continue;
        };
        // Collect one context per endpoint, once; no requests for unrelated plugins.
        if targets.iter().take_while(|t| t.id != target.id).any(|t| {
            t.content.as_ref().is_some_and(|c| {
                c.provider == content.provider
                    && c.instance == content.instance
                    && c.context == content.context
            })
        }) {
            continue;
        }
        let group: Vec<_> = targets
            .iter()
            .take(8)
            .filter(|t| {
                t.content.as_ref().is_some_and(|c| {
                    c.provider == content.provider
                        && c.instance == content.instance
                        && c.context == content.context
                })
            })
            .collect();
        let items: Vec<_> = group
            .iter()
            .map(|t| {
                let c = t.content.as_ref().unwrap();
                json!({"id":c.item,"url":c.subtitle})
            })
            .collect();
        if let Ok(reply) = rpc(
            endpoint,
            "thumbnails",
            json!({"context":content.context,"items":items}),
        ) {
            merge_thumbnails(&mut images, &group, &reply);
        }
    }
    images
}
fn merge_thumbnails(images: &mut HashMap<String, String>, targets: &[&Destination], reply: &Value) {
    let Some(items) = reply["items"].as_array().filter(|items| items.len() <= 8) else {
        return;
    };
    for target in targets {
        let Some(content) = &target.content else {
            continue;
        };
        if reply["context"] != content.context {
            continue;
        }
        if let Some(image) = items
            .iter()
            .find(|item| item["id"] == content.item && item["url"] == content.subtitle)
            .and_then(|item| item["image"].as_str())
            .filter(|s| s.len() <= 60 * 1024 && s.starts_with("data:image/jpeg;base64,"))
        {
            images.insert(target.id.clone(), image.to_owned());
        }
    }
}
/// true means the adapter read back the exact selected target; false is dispatch-only.
pub fn activate(target: &Destination) -> Result<bool, String> {
    let content = target.content.as_ref().ok_or("Missing tab target")?;
    if !crate::plugin_manager::enabled(&content.provider) {
        return Err("This plugin is disabled".into());
    }
    if content.provider == "codex" {
        return crate::codex_plugin::activate(content);
    }
    let endpoint = discover_enabled()
        .into_iter()
        .find(|e| e.provider == content.provider && e.instance == content.instance)
        .ok_or("Plugin restarted or disconnected. Open the switcher again.")?;
    let reply = rpc(
        &endpoint,
        "activate",
        json!({"context":content.context,"item":content.item}),
    )?;
    if reply["context"] != content.context
        || reply["item"] != content.item
        || reply["verified"] != true
    {
        return Err("The plugin could not confirm the selected tab".into());
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presentation_is_context_owned_with_legacy_capability_defaults() {
        let mut endpoint: Endpoint = serde_json::from_value(json!({
            "protocol":1,"provider":"third.party","instance":"epoch",
            "appIds":[],"port":1,"token":"x".repeat(32)
        }))
        .unwrap();
        let context = |presentation: Option<&str>| {
            let mut value = json!({"id":"window","focused":true,"items":[{
                "id":"file","title":"same.rs","subtitle":"/project/same.rs",
                "description":"Bounded searchable summary","preview":true
            }]});
            if let Some(p) = presentation {
                value["presentation"] = json!(p);
            }
            serde_json::from_value::<Context>(value).unwrap()
        };
        let parent = Destination::default();
        let legacy = destinations(&parent, &endpoint, context(None)).unwrap();
        let c = legacy[0].content.as_ref().unwrap();
        assert_eq!(c.presentation, ContentPresentation::Text);
        assert!(!c.preview);
        assert_eq!(c.description, "Bounded searchable summary");
        endpoint.capabilities.push("thumbnails".into());
        for (requested, expected) in [
            (None, ContentPresentation::Thumbnails),
            (Some("text"), ContentPresentation::Text),
            (Some("thumbnails"), ContentPresentation::Thumbnails),
        ] {
            let items = destinations(&parent, &endpoint, context(requested)).unwrap();
            let c = items[0].content.as_ref().unwrap();
            assert_eq!(c.presentation, expected);
            assert_eq!(c.preview, expected == ContentPresentation::Thumbnails);
        }
        let mut oversized = context(Some("text"));
        oversized.items[0].description = "x".repeat(8193);
        assert!(destinations(&parent, &endpoint, oversized).is_err());
        assert!(serde_json::from_value::<Context>(json!({
            "id":"window","focused":true,"presentation":"unknown","items":[]
        }))
        .is_err());
    }
    #[test]
    fn duplicate_titles_have_distinct_ids_but_duplicate_ids_are_rejected() {
        let endpoint = Endpoint {
            protocol: 1,
            provider: "test".into(),
            name: None,
            version: None,
            instance: "epoch".into(),
            app_ids: vec![],
            port: 1,
            token: "x".repeat(32),
            capabilities: vec![],
        };
        let parent = Destination {
            id: "native-window".into(),
            pid: 42,
            ..Default::default()
        };
        let context = |ids: &[&str]| Context {
            id: "context".into(),
            focused: true,
            presentation: None,
            items: ids
                .iter()
                .map(|id| Item {
                    id: (*id).into(),
                    title: "same".into(),
                    subtitle: "".into(),
                    description: "".into(),
                    active: false,
                    icon: None,
                    preview: false,
                })
                .collect(),
        };
        let items = destinations(&parent, &endpoint, context(&["1", "2"])).unwrap();
        assert_ne!(items[0].id, items[1].id);
        assert_eq!(items[1].native_target().id, "native-window");
        assert!(destinations(&parent, &endpoint, context(&["1", "1"])).is_err());
    }
    #[test]
    fn bounded_frames_reject_truncation_and_accept_unicode() {
        assert!(read_line(&mut &b"{}"[..]).is_err());
        assert!(read_line(&mut vec![b'x'; MAX_MESSAGE + 1].as_slice()).is_err());
        assert_eq!(
            read_line(&mut "{\"title\":\"工作\"}\n".as_bytes()).unwrap()["title"],
            "工作"
        );
        assert_eq!(app_key("C:\\Apps\\Code.exe"), "code.exe");
    }
    #[test]
    fn preview_cache_replies_require_exact_context_item_url_and_bounded_inline_images() {
        let target = Destination {
            id: "target".into(),
            content: Some(ContentRef {
                provider: "browser".into(),
                instance: "epoch".into(),
                context: "10".into(),
                item: "1".into(),
                parent_id: "native".into(),
                subtitle: "https://page.test".into(),
                active: false,
                preview: true,
                presentation: ContentPresentation::Thumbnails,
                ..Default::default()
            }),
            ..Default::default()
        };
        let image = "data:image/jpeg;base64,/9j/test";
        let good =
            json!({"context":"10","items":[{"id":"1","url":"https://page.test","image":image}]});
        let mut images = HashMap::new();
        merge_thumbnails(&mut images, &[&target], &good);
        assert_eq!(images.get("target").map(String::as_str), Some(image));
        for (pointer, value) in [
            ("/context", "11".to_string()),
            ("/items/0/id", "2".into()),
            ("/items/0/url", "https://new.test".into()),
            ("/items/0/image", "https://remote.test/image".into()),
            (
                "/items/0/image",
                format!("{image}{}", "x".repeat(60 * 1024)),
            ),
        ] {
            let mut bad = good.clone();
            *bad.pointer_mut(pointer).unwrap() = json!(value);
            images.clear();
            merge_thumbnails(&mut images, &[&target], &bad);
            assert!(images.is_empty());
        }
        let legacy: Endpoint = serde_json::from_value(json!({"protocol":1,"provider":"vscode","instance":"epoch","appIds":[],"port":1,"token":"x".repeat(32)})).unwrap();
        assert!(legacy.capabilities.is_empty());
    }
}
