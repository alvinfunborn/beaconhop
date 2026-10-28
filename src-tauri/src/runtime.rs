use crate::{
    config::{self, Config},
    engine::{Action, Engine, KeyEvent},
    model::*,
    platform,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
struct Runtime {
    app: AppHandle,
    engine: Mutex<Engine>,
    sender: mpsc::Sender<Action>,
    config_path: PathBuf,
    previews: Mutex<HashMap<String, (Instant, String)>>,
    capture: Mutex<()>,
    config_warning: Mutex<Option<String>>,
}
static RECORDING: AtomicBool = AtomicBool::new(false);
static RECORDED_KEYS: Mutex<Vec<u32>> = Mutex::new(Vec::new());
static RUNTIME: OnceLock<Arc<Runtime>> = OnceLock::new();
fn rt() -> &'static Arc<Runtime> {
    RUNTIME.get().expect("runtime initialized")
}
fn dispatch(actions: Vec<Action>) {
    for action in actions {
        let _ = rt().sender.send(action);
    }
}
pub fn key(event: KeyEvent) -> bool {
    let Some(rt) = RUNTIME.get() else {
        return false;
    };
    {
        let mut keys = RECORDED_KEYS.lock().unwrap();
        if !event.down && keys.contains(&event.code) {
            keys.retain(|k| *k != event.code);
            return true;
        }
    }
    if RECORDING.load(Ordering::Acquire)
        && event.down
        && !matches!(event.key.as_str(), "Alt" | "Control" | "Super" | "Shift")
    {
        let mut pieces = Vec::new();
        for (bit, name) in [
            (config::CTRL, "Ctrl"),
            (config::ALT, "Alt"),
            (config::SUPER, "Super"),
            (config::SHIFT, "Shift"),
        ] {
            if event.modifiers & bit != 0 {
                pieces.push(name);
            }
        }
        pieces.push(&event.key);
        let shortcut = pieces.join("+");
        if event.key == "Escape" || config::Shortcut::parse(&shortcut).is_ok() {
            RECORDING.store(false, Ordering::Release);
            let _ = rt.sender.send(Action::Record(if event.key == "Escape" {
                String::new()
            } else {
                shortcut
            }));
        }
        RECORDED_KEYS.lock().unwrap().push(event.code);
        return true;
    }
    let response = rt.engine.lock().unwrap().handle(event);
    for action in response.actions {
        let _ = rt.sender.send(action);
    }
    response.consumed
}
pub fn init(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::var_os("BEACONHOP_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(app.path().app_config_dir()?);
    let path = directory.join("settings.json");
    let first = !path.exists();
    let mut config_error = None;
    let config = config::load(&path).unwrap_or_else(|e| {
        config_error = Some(e);
        Config::default()
    });
    if first {
        config::save(&path, &config)?;
    }
    let show = first || !config.start_in_tray && !std::env::args().any(|a| a == "--background");
    let (sender, receiver) = mpsc::channel();
    let runtime = Arc::new(Runtime {
        app: app.clone(),
        engine: Mutex::new(Engine::new(config)),
        sender,
        config_path: path,
        previews: Mutex::new(HashMap::new()),
        capture: Mutex::new(()),
        config_warning: Mutex::new(config_error.clone()),
    });
    RUNTIME
        .set(runtime.clone())
        .map_err(|_| "Already initialized")?;
    if let Some(error) = config_error {
        runtime
            .engine
            .lock()
            .unwrap()
            .snapshot
            .warnings
            .push(format!("Could not load settings: {error}"));
        log::error!("Settings could not be loaded: {error}");
    }
    std::thread::Builder::new()
        .name("window-inventory".into())
        .spawn(move || loop {
            match platform::snapshot() {
                Ok(mut snapshot) => {
                    if let Some(error) = rt().config_warning.lock().unwrap().as_ref() {
                        snapshot
                            .warnings
                            .push(format!("Could not load settings: {error}"));
                    }
                    let mut e = rt().engine.lock().unwrap();
                    snapshot.focused_id = e.snapshot.focused_id.clone();
                    e.update(snapshot);
                    drop(e);
                    #[cfg(debug_assertions)]
                    write_probe();
                }
                Err(error) => {
                    log::warn!("Window inventory failed: {error}");
                }
            }
            std::thread::sleep(Duration::from_millis(600));
        })?;
    std::thread::Builder::new()
        .name("window-focus".into())
        .spawn(move || loop {
            let focused = platform::focused_id();
            rt().engine.lock().unwrap().observe_focus(focused);
            std::thread::sleep(Duration::from_millis(80));
        })?;
    std::thread::Builder::new()
        .name("switcher-actions".into())
        .spawn(move || {
            for action in receiver {
                perform(action);
            }
        })?;
    #[cfg(target_os = "macos")]
    {
        crate::macos_access::log_executable_identity();
        crate::macos_access::log_accessibility_status();
    }
    if show {
        show_settings(&app);
    }
    Ok(())
}
fn current_session() -> Session {
    let e = rt().engine.lock().unwrap();
    let mut s = e.session.clone();
    s.result_ids = e.results().iter().map(|w| w.window.id.clone()).collect();
    s
}
fn publish() {
    let session = current_session();
    let _ = rt().app.emit("session", session);
}
fn show(search: bool) {
    if rt().engine.lock().unwrap().session.mode == Mode::Inactive {
        return;
    }
    let Some(window) = rt().app.get_webview_window("switcher") else {
        return;
    };
    let session = rt().engine.lock().unwrap().session.clone();
    if let Some(display) = session.display {
        let b = display.bounds;
        #[cfg(target_os = "macos")]
        let scale = 1.; // macOS screen bounds are already logical points.
        #[cfg(target_os = "windows")]
        let scale = display.scale.max(1.);
        let width = (b.width - 64. * scale).clamp(480. * scale, 1100. * scale);
        let height = (b.height - 96. * scale).clamp(360. * scale, 720. * scale);
        #[cfg(target_os = "macos")]
        {
            let _ = window.set_size(tauri::LogicalSize::new(width, height));
            let _ = window.set_position(tauri::LogicalPosition::new(
                b.x + (b.width - width) / 2.,
                b.y + (b.height - height) / 2.,
            ));
        }
        #[cfg(target_os = "windows")]
        {
            let _ = window.set_size(tauri::PhysicalSize::new(width as u32, height as u32));
            let _ = window.set_position(tauri::PhysicalPosition::new(
                (b.x + (b.width - width) / 2.) as i32,
                (b.y + (b.height - height) / 2.) as i32,
            ));
        }
    }
    platform::show_panel(&window, search);
}
fn hide() {
    platform::clear_previews();
    if let Some(w) = rt().app.get_webview_window("switcher") {
        let _ = w.hide();
    }
}
fn perform(action: Action) {
    match action {
        Action::Record(shortcut) => {
            let _ = rt().app.emit("shortcut-recorded", shortcut);
        }
        Action::Publish => publish(),
        Action::Show => {
            let search = rt().engine.lock().unwrap().session.mode == Mode::Search;
            show(search);
        }
        Action::Search => show(true),
        Action::Activate(session_id, target) => {
            if rt().engine.lock().unwrap().session.session_id != session_id {
                return;
            }
            hide();
            match platform::activate(&target) {
                Ok(()) => {
                    rt().engine
                        .lock()
                        .unwrap()
                        .finish_activation(session_id, Some(target.id));
                    publish();
                }
                Err(error) => {
                    log::warn!("Window activation failed: {error}");
                    let focused = platform::focused_id();
                    {
                        let mut e = rt().engine.lock().unwrap();
                        e.finish_activation(session_id, focused);
                        if e.session.session_id != session_id {
                            return;
                        }
                        e.session.mode = Mode::Search;
                        e.session.error = Some(error);
                        e.session.revision += 1;
                    }
                    show(true);
                    publish();
                }
            }
        }
        Action::Cancel(session_id, origin) => {
            if rt().engine.lock().unwrap().session.session_id != session_id {
                return;
            }
            hide();
            if let Some(origin) = origin {
                let focused = if platform::activate(&origin).is_ok() {
                    Some(origin.id)
                } else {
                    platform::focused_id()
                };
                rt().engine
                    .lock()
                    .unwrap()
                    .finish_activation(session_id, focused);
            }
            publish();
        }
    }
}
pub fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}
pub fn open_search_inner() {
    let actions = rt().engine.lock().unwrap().open(Mode::Search, false);
    dispatch(actions);
}
pub fn cancel_inner() {
    let actions = rt().engine.lock().unwrap().cancel();
    dispatch(actions);
}
pub fn lost_focus() {
    if RUNTIME.get().is_none() {
        return;
    }
    let mut e = rt().engine.lock().unwrap();
    if e.session.mode == Mode::Search {
        e.session.mode = Mode::Inactive;
        drop(e);
        hide();
        publish();
    }
}
#[tauri::command]
pub fn get_settings() -> Config {
    rt().engine.lock().unwrap().config.clone()
}
#[tauri::command]
pub fn save_settings(config: Config) -> Result<Config, String> {
    config.validate()?;
    let old = rt().engine.lock().unwrap().config.clone();
    if old.start_at_login != config.start_at_login {
        let auto = rt().app.autolaunch();
        if config.start_at_login {
            auto.enable()
        } else {
            auto.disable()
        }
        .map_err(|e| e.to_string())?;
    }
    if let Err(error) = config::save(&rt().config_path, &config) {
        let auto = rt().app.autolaunch();
        let _ = if old.start_at_login {
            auto.enable()
        } else {
            auto.disable()
        };
        return Err(error);
    }
    let mut e = rt().engine.lock().unwrap();
    if e.session.mode != Mode::Inactive {
        let actions = e.cancel();
        dispatch(actions);
    }
    e.config = config.clone();
    *rt().config_warning.lock().unwrap() = None;
    drop(e);
    let _ = rt().app.emit("settings", &config);
    Ok(config)
}
#[tauri::command]
pub fn get_session() -> Session {
    current_session()
}
#[tauri::command]
pub fn open_search() {
    open_search_inner();
}
#[tauri::command]
pub fn search(query: String, session_id: u64) {
    let mut e = rt().engine.lock().unwrap();
    if e.session.session_id == session_id && e.session.mode == Mode::Search {
        e.search(query);
        drop(e);
        dispatch(vec![Action::Publish]);
    }
}
#[tauri::command]
pub fn navigate(delta: isize, session_id: u64) {
    let mut e = rt().engine.lock().unwrap();
    if e.session.session_id != session_id || e.session.mode == Mode::Inactive {
        return;
    }
    e.navigate(delta);
    drop(e);
    dispatch(vec![Action::Publish]);
}
#[tauri::command]
pub fn activate(id: Option<String>, session_id: u64) {
    let mut e = rt().engine.lock().unwrap();
    if e.session.session_id == session_id && e.session.mode != Mode::Inactive {
        let actions = e.activate(id.as_deref());
        drop(e);
        dispatch(actions);
    }
}
#[tauri::command]
pub fn cancel() {
    cancel_inner();
}
#[tauri::command]
pub fn get_permissions() -> PermissionStatus {
    platform::permissions()
}
#[tauri::command]
pub fn request_permission(kind: String) -> Result<(), String> {
    platform::request_permission(&kind)
}
#[tauri::command]
pub async fn get_thumbnail(id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = rt();
        let _capture = runtime.capture.lock().unwrap();
        if let Some((time, data)) = runtime.previews.lock().unwrap().get(&id) {
            if time.elapsed() < Duration::from_secs(3) {
                return Ok(Some(data.clone()));
            }
        }
        let target = {
            let e = runtime.engine.lock().unwrap();
            if !e.config.thumbnails || e.session.mode == Mode::Inactive {
                return Ok(None);
            }
            e.snapshot.windows.iter().find(|w| w.id == id).cloned()
        };
        let Some(target) = target else {
            return Ok(None);
        };
        let data = platform::thumbnail(&target);
        if let Some(ref data) = data {
            let mut cache = runtime.previews.lock().unwrap();
            if cache.len() >= 80 {
                cache.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(3));
                if cache.len() >= 80 {
                    cache.clear();
                }
            }
            cache.insert(id, (Instant::now(), data.clone()));
        }
        Ok(data)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn get_diagnostics() -> serde_json::Value {
    let e = rt().engine.lock().unwrap();
    serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"permissions":platform::permissions(),"windowCount":e.snapshot.windows.len(),"displayCount":e.snapshot.displays.len(),"desktopKnown":e.snapshot.windows.iter().filter(|w|w.current_desktop.is_some()).count(),"warnings":e.snapshot.warnings,"configPath":rt().config_path,"sessionMode":e.session.mode})
}

#[tauri::command]
pub fn record_shortcut(enabled: bool) {
    RECORDING.store(enabled, Ordering::Release);
}
#[tauri::command]
pub fn set_live_preview(id: String, session_id: u64, bounds: Option<Bounds>) -> bool {
    let e = rt().engine.lock().unwrap();
    if e.session.session_id != session_id || e.session.mode == Mode::Inactive {
        return false;
    }
    let Some(target) = e
        .session
        .windows
        .iter()
        .find(|w| w.window.id == id)
        .map(|w| w.window.clone())
    else {
        return false;
    };
    drop(e);
    let Some(panel) = rt().app.get_webview_window("switcher") else {
        return false;
    };
    platform::live_preview(&panel, &format!("{session_id}:{id}"), &target, bounds)
}

#[cfg(debug_assertions)]
fn write_probe() {
    let Some(path) = std::env::var_os("BEACONHOP_DIAGNOSTICS_FILE") else {
        return;
    };
    let e = rt().engine.lock().unwrap();
    let data = serde_json::json!({"processId":std::process::id(),"permissions":platform::permissions(),"windows":e.snapshot.windows.iter().map(|w|serde_json::json!({"id":w.id,"pid":w.pid,"nativeId":w.native_id,"displayId":w.display_id,"desktopId":w.desktop_id,"currentDesktop":w.current_desktop,"minimized":w.minimized,"hidden":w.hidden})).collect::<Vec<_>>(),"displays":e.snapshot.displays,"focusedId":e.snapshot.focused_id,"sessionMode":e.session.mode,"sessionId":e.session.session_id,"selected":e.session.selected,"hints":e.session.windows.iter().map(|w|serde_json::json!({"id":w.window.id,"hint":w.hint})).collect::<Vec<_>>(),"warnings":e.snapshot.warnings});
    let _ = std::fs::write(path, serde_json::to_vec_pretty(&data).unwrap());
}
