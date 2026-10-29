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
static RECORD_SINGLE_KEY: AtomicBool = AtomicBool::new(false);
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
        if event.repeat {
            return true;
        }
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
        let valid = if RECORD_SINGLE_KEY.load(Ordering::Acquire) {
            config::parse_search_entry_key(&shortcut).is_ok()
        } else {
            config::Shortcut::parse(&shortcut).is_ok()
        };
        if event.key == "Escape" || valid {
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
    let mut engine = Engine::new(config.clone());
    engine.hints = crate::stable_hints::StableHints::load(&directory.join("hints.json"));
    let runtime = Arc::new(Runtime {
        app: app.clone(),
        engine: Mutex::new(engine),
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
                    let learned = if e.hints.dirty {
                        e.hints.dirty = false;
                        serde_json::to_vec(&e.hints).ok()
                    } else {
                        None
                    };
                    drop(e);
                    if let Some(data) = learned {
                        let path = rt().config_path.with_file_name("hints.json");
                        let pending = path.with_extension("pending");
                        if let Err(error) = std::fs::write(&pending, data)
                            .and_then(|_| std::fs::rename(&pending, &path))
                        {
                            log::warn!("Could not save stable hints: {error}");
                        }
                    }
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
    std::thread::Builder::new()
        .name("preview-warmup".into())
        .spawn(move || {
            let mut warmed = false;
            let mut previous = None;
            loop {
                std::thread::sleep(Duration::from_millis(1000));
                let (enabled, active, focused, windows) = {
                    let e = rt().engine.lock().unwrap();
                    (
                        e.config.thumbnails && e.config.layout == "grid",
                        e.session.mode != Mode::Inactive,
                        e.snapshot.focused_id.clone(),
                        e.snapshot.windows.clone(),
                    )
                };
                if !enabled || !platform::permissions().screen_recording {
                    warmed = false;
                    rt().previews.lock().unwrap().clear();
                    continue;
                }
                if active {
                    continue;
                }
                let targets: Vec<_> = if !warmed {
                    windows.into_iter().take(80).collect()
                } else if focused != previous {
                    windows
                        .into_iter()
                        .filter(|w| Some(&w.id) == focused.as_ref())
                        .collect()
                } else {
                    vec![]
                };
                if !targets.is_empty() {
                    capture_previews(&targets);
                    warmed = true;
                }
                previous = focused;
            }
        })?;
    #[cfg(target_os = "macos")]
    {
        crate::macos_access::log_executable_identity();
        crate::macos_access::log_accessibility_status();
    }
    if show || (platform::permissions().required && !platform::permissions().accessibility) {
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
        let windows: Vec<_> = session.windows.iter().map(|w| w.window.clone()).collect();
        let compact = rt().engine.lock().unwrap().config.layout == "list";
        let logical = Bounds {
            width: b.width / scale,
            height: b.height / scale,
            ..Bounds::default()
        };
        let (width, height) = crate::panel::size(
            &windows,
            &logical,
            compact,
            session.warnings.len().min(3) as f64 * 36.,
        );
        let (width, height) = (width * scale, height * scale);
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
        Action::ScreenBuoy(session_id, target, held_keys) => {
            std::thread::spawn(move || {
                let current = || {
                    let e = rt().engine.lock().unwrap();
                    let valid = e.sb_pending
                        && e.config.screen_buoy.enabled
                        && e.session.session_id == session_id
                        && e.session.mode == Mode::Inactive
                        && e.snapshot
                            .windows
                            .iter()
                            .any(|w| w.id == target.id && w.pid == target.pid);
                    drop(e);
                    valid && platform::focused_id().as_ref() == Some(&target.id)
                };
                if !current() {
                    return;
                }
                let config = rt().engine.lock().unwrap().config.screen_buoy.clone();
                let result = rt()
                    .app
                    .path()
                    .home_dir()
                    .map_err(|e| e.to_string())
                    .and_then(|home| crate::screen_buoy::application_path(&config, &home))
                    .and_then(|path| {
                        crate::screen_buoy::handoff(&path, &target, &held_keys, &current)
                    });
                if let Err(error) = result {
                    if current() {
                        log::warn!("Screen Buoy handoff failed: {error}");
                        show_settings(&rt().app);
                        let _ = rt().app.emit("screen-buoy-error", error);
                    }
                }
                let mut e = rt().engine.lock().unwrap();
                if e.session.session_id == session_id {
                    e.sb_pending = false;
                }
            });
        }
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
        if !platform::permissions().ready {
            let _ = w.emit("show-permissions", ());
        }
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        #[cfg(target_os = "macos")]
        platform::focus_settings(&w);
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
pub fn restart_application() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if let Ok(executable) = std::env::current_exe() {
        if let Some(bundle) = executable
            .ancestors()
            .find(|p| p.extension().is_some_and(|e| e == "app"))
        {
            // Re-executing the binary bypasses Launch Services registration and
            // can leave the replacement unable to activate its search window.
            // Wait for this instance to exit before the single-instance plugin
            // accepts the Launch Services replacement. Pass paths as arguments.
            std::process::Command::new("/bin/sh")
                .args(["-c", "i=0; while /bin/kill -0 \"$1\" 2>/dev/null && [ \"$i\" -lt 100 ]; do /bin/sleep 0.1; i=$((i+1)); done; exec /usr/bin/open -n \"$2\"", "beaconhop-relaunch"])
                .arg(std::process::id().to_string())
                .arg(bundle)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|error| format!("Could not restart BeaconHop: {error}"))?;
            rt().app.exit(0);
            return Ok(());
        }
    }
    rt().app.request_restart();
    Ok(())
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
    e.clear_extension();
    *rt().config_warning.lock().unwrap() = None;
    drop(e);
    crate::update_tray_language(&rt().app, &config.language);
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
pub fn set_navigation(session_id: u64, rectangles: HashMap<String, Bounds>) {
    let mut e = rt().engine.lock().unwrap();
    if e.session.session_id != session_id || e.session.mode == Mode::Inactive {
        return;
    }
    e.navigation = rectangles
        .into_iter()
        .filter(|(id, b)| {
            e.session.windows.iter().any(|w| &w.window.id == id)
                && [b.x, b.y, b.width, b.height].iter().all(|n| n.is_finite())
                && b.width > 0.
                && b.height > 0.
        })
        .collect();
}
#[tauri::command]
pub fn navigate_direction(direction: String, session_id: u64) {
    let mut e = rt().engine.lock().unwrap();
    if e.session.session_id != session_id || e.session.mode == Mode::Inactive {
        return;
    }
    e.navigate_direction(&direction);
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
// Cache reads never wait behind a capture. Keep old images until their replacements are ready.
fn preview_targets(ids: &[String], session_id: u64) -> Vec<Destination> {
    let e = rt().engine.lock().unwrap();
    if !e.config.thumbnails
        || e.session.mode == Mode::Inactive
        || e.session.session_id != session_id
    {
        return vec![];
    }
    e.session
        .windows
        .iter()
        .filter(|w| ids.contains(&w.window.id))
        .take(80)
        .map(|w| w.window.clone())
        .collect()
}
fn cached_previews(windows: &[Destination]) -> HashMap<String, String> {
    let cache = rt().previews.lock().unwrap();
    windows
        .iter()
        .filter_map(|w| {
            cache
                .get(&w.id)
                .map(|(_, data)| (w.id.clone(), data.clone()))
        })
        .collect()
}
fn capture_previews(windows: &[Destination]) -> HashMap<String, String> {
    let _capture = rt().capture.lock().unwrap();
    if !platform::permissions().screen_recording {
        rt().previews.lock().unwrap().clear();
        return HashMap::new();
    }
    let stale: Vec<_> = {
        let cache = rt().previews.lock().unwrap();
        windows
            .iter()
            .filter(|w| {
                cache
                    .get(&w.id)
                    .is_none_or(|(t, _)| t.elapsed() >= Duration::from_secs(3))
            })
            .cloned()
            .collect()
    };
    if !stale.is_empty() {
        let started = Instant::now();
        let images = platform::thumbnails(&stale);
        let captured = images.len();
        let live: Vec<_> = rt()
            .engine
            .lock()
            .unwrap()
            .snapshot
            .windows
            .iter()
            .map(|w| w.id.clone())
            .collect();
        let mut cache = rt().previews.lock().unwrap();
        cache.retain(|id, _| live.contains(id));
        for (id, data) in images {
            cache.insert(id, (Instant::now(), data));
        }
        if cache.len() > 80 {
            let mut oldest: Vec<_> = cache
                .iter()
                .map(|(id, (time, _))| (id.clone(), *time))
                .collect();
            oldest.sort_by_key(|(_, time)| *time);
            for (id, _) in oldest.into_iter().take(cache.len() - 80) {
                cache.remove(&id);
            }
        }
        log::debug!(
            "Preview batch: {captured}/{} in {}ms",
            stale.len(),
            started.elapsed().as_millis()
        );
    }
    cached_previews(windows)
}
#[tauri::command]
pub fn get_cached_thumbnails(ids: Vec<String>, session_id: u64) -> HashMap<String, String> {
    if !platform::permissions().screen_recording {
        rt().previews.lock().unwrap().clear();
        return HashMap::new();
    }
    cached_previews(&preview_targets(&ids, session_id))
}
#[tauri::command]
pub async fn get_thumbnails(
    ids: Vec<String>,
    session_id: u64,
) -> Result<HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        capture_previews(&preview_targets(&ids, session_id))
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn get_diagnostics() -> serde_json::Value {
    let e = rt().engine.lock().unwrap();
    serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"permissions":platform::permissions(),"previewCount":rt().previews.lock().unwrap().len(),"windowCount":e.snapshot.windows.len(),"displayCount":e.snapshot.displays.len(),"desktopKnown":e.snapshot.windows.iter().filter(|w|w.current_desktop.is_some()).count(),"warnings":e.snapshot.warnings,"configPath":rt().config_path,"sessionMode":e.session.mode})
}

#[tauri::command]
pub fn record_shortcut(enabled: bool, single_key: Option<bool>) -> bool {
    RECORD_SINGLE_KEY.store(single_key.unwrap_or(false), Ordering::Release);
    RECORDING.store(enabled, Ordering::Release);
    crate::input::is_ready()
}
#[tauri::command]
pub fn set_live_preview(
    id: String,
    session_id: u64,
    bounds: Option<Bounds>,
    hint_bounds: Option<Bounds>,
) -> bool {
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
    platform::live_preview(
        &panel,
        &format!("{session_id}:{id}"),
        &target,
        bounds,
        hint_bounds,
    )
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
