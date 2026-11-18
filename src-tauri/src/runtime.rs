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
    capture: crate::capture_gate::CaptureGate,
    inventory: Mutex<()>,
    presentation: Mutex<crate::presentation::Presentation>,
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
    let started = crate::performance::performance_enabled().then(Instant::now);
    let mut e = rt.engine.lock().unwrap();
    let previous = e.session.session_id;
    let response = e.handle(event);
    let session_id = e.session.session_id;
    drop(e);
    if session_id != previous {
        if let Some(started) = started {
            crate::performance::record(
                "shortcut",
                session_id,
                serde_json::json!({"elapsedMs":started.elapsed().as_secs_f64()*1000.}),
            );
        }
    }
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
    engine.overview = std::fs::read(directory.join("overview.json"))
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default();
    let runtime = Arc::new(Runtime {
        app: app.clone(),
        engine: Mutex::new(engine),
        sender,
        config_path: path,
        previews: Mutex::new(HashMap::new()),
        capture: crate::capture_gate::CaptureGate::default(),
        inventory: Mutex::new(()),
        presentation: Mutex::new(crate::presentation::Presentation::default()),
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
            let inventory = rt().inventory.lock().unwrap();
            match platform::snapshot() {
                Ok(mut snapshot) => {
                    if let Some(error) = rt().config_warning.lock().unwrap().as_ref() {
                        snapshot
                            .warnings
                            .push(format!("Could not load settings: {error}"));
                    }
                    let tab_apps = crate::plugins::supported_apps();
                    let mut e = rt().engine.lock().unwrap();
                    e.tab_apps = tab_apps;
                    snapshot.focused_id = e.snapshot.focused_id.clone();
                    let topology_changed = serde_json::to_string(&snapshot.displays).ok()
                        != serde_json::to_string(&e.snapshot.displays).ok();
                    let displays = snapshot.displays.clone();
                    if topology_changed && e.session.mode != Mode::Inactive {
                        // A disconnected screen cannot retain an invisible selection.
                        let actions = e.dismiss();
                        dispatch(actions);
                    }
                    e.update(snapshot);
                    let learned = if e.hints.dirty {
                        e.hints.dirty = false;
                        serde_json::to_vec(&e.hints).ok()
                    } else {
                        None
                    };
                    drop(e);
                    if topology_changed {
                        dispatch(vec![Action::PrepareDisplays(displays)]);
                    }
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
            drop(inventory);
            std::thread::sleep(Duration::from_millis(600));
        })?;
    std::thread::Builder::new()
        .name("window-focus".into())
        .spawn(move || loop {
            let session_id = rt().engine.lock().unwrap().session.session_id;
            let focused = platform::focused_id();
            let mut e = rt().engine.lock().unwrap();
            let actions = if e.session.session_id == session_id {
                e.observe_native_focus(focused)
            } else {
                vec![]
            };
            drop(e);
            dispatch(actions);
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
            let mut attempted = HashMap::<String, (Instant, u8)>::new();
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
                attempted.retain(|id, _| windows.iter().any(|w| &w.id == id));
                // Fill startup misses and newly opened windows while idle. Stop
                // retrying persistently uncapturable windows after three tries.
                let targets: Vec<_> = {
                    let cache = rt().previews.lock().unwrap();
                    windows
                        .into_iter()
                        .filter(|w| {
                            !warmed
                                || focused != previous && Some(&w.id) == focused.as_ref()
                                || !cache.contains_key(&w.id)
                                    && attempted.get(&w.id).is_none_or(|(t, n)| {
                                        *n < 3 && t.elapsed() >= Duration::from_secs(5)
                                    })
                        })
                        .take(if warmed { 8 } else { 80 })
                        .collect()
                };
                if !targets.is_empty() {
                    for target in &targets {
                        let attempt = attempted
                            .entry(target.id.clone())
                            .or_insert((Instant::now(), 0));
                        *attempt = (Instant::now(), attempt.1.saturating_add(1));
                    }
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
    if !session.overview.is_empty() {
        let saved = serde_json::to_vec(&rt().engine.lock().unwrap().overview).ok();
        if let Some(data) = saved {
            let path = rt().config_path.with_file_name("overview.json");
            let pending = path.with_extension("pending");
            if let Err(error) =
                std::fs::write(&pending, data).and_then(|_| std::fs::rename(pending, path))
            {
                log::warn!("Could not save overview positions: {error}");
            }
        }
        if let Err(error) =
            crate::overview_windows::prepare(&rt().app, &session.overview).and_then(|windows| {
                let panels = windows
                    .into_iter()
                    .zip(&session.overview)
                    .map(|(window, panel)| {
                        let scale = crate::overview::coordinate_scale(&panel.display);
                        (
                            window,
                            (panel.bounds.width / scale, panel.bounds.height / scale),
                        )
                    })
                    .collect();
                prepare_presentation(panels, search)
            })
        {
            log::error!("Could not show all display overviews: {error}");
            let actions = rt().engine.lock().unwrap().cancel();
            dispatch(actions);
            hide();
        }
        return;
    }
    for (label, other) in rt().app.webview_windows() {
        if label.starts_with("switcher-display-") {
            let _ = other.hide();
        }
    }
    let mut desired_size = window
        .inner_size()
        .ok()
        .map(|size| size.to_logical::<f64>(window.scale_factor().unwrap_or(1.)))
        .map(|size| (size.width, size.height))
        .unwrap_or((1000., 640.));
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
        let text_content = session.layer == Layer::Tabs
            && (compact
                || windows
                    .first()
                    .and_then(|w| w.content.as_ref())
                    .is_none_or(|c| c.presentation == crate::model::ContentPresentation::Text));
        let (width, height) = if text_content {
            crate::panel::text_size(
                &windows,
                &logical,
                session.warnings.len().min(3) as f64 * 36.,
            )
        } else {
            crate::panel::size(
                &windows[..windows.len().min(80)],
                &logical,
                compact,
                session.warnings.len().min(3) as f64 * 36.,
            )
        };
        desired_size = (width, height);
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
    if let Err(error) = prepare_presentation(vec![(window, desired_size)], search) {
        log::warn!("Could not prepare panel: {error}");
    }
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPresentation {
    label: String,
    generation: u64,
    width: f64,
    height: f64,
    session: Session,
}
fn prepare_presentation(
    windows: Vec<(tauri::WebviewWindow, (f64, f64))>,
    search: bool,
) -> tauri::Result<()> {
    // set_size / per-monitor scale changes are asynchronous. Reading inner_size
    // here can return the previous viewport; use the geometry we requested.
    let panels = windows
        .iter()
        .map(|(window, (width, height))| (window.label().to_string(), (*width, *height, false)))
        .collect();
    let session = current_session();
    if session.mode == Mode::Inactive {
        return Ok(());
    }
    rt().presentation
        .lock()
        .unwrap()
        .begin(session.session_id, search, panels);
    for (window, _) in windows {
        #[cfg(target_os = "macos")]
        platform::prepare_panel(&window);
        if let Some(frame) = get_panel_presentation(window.clone()) {
            window.emit_to(window.label(), "panel-presentation", frame)?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn get_panel_presentation(window: tauri::WebviewWindow) -> Option<PanelPresentation> {
    let session = current_session();
    let p = rt().presentation.lock().unwrap();
    if session.mode == Mode::Inactive || session.session_id != p.session_id {
        return None;
    }
    let &(width, height, _) = p.panels.get(window.label())?;
    Some(PanelPresentation {
        label: window.label().to_string(),
        generation: p.generation,
        width,
        height,
        session,
    })
}
#[tauri::command]
pub fn panel_ready(window: tauri::WebviewWindow, generation: u64) {
    // Run the validation and exposure together on the native UI queue. A late
    // acknowledgement must never reopen a dismissed or superseded session.
    let label = window.label().to_string();
    let _ = rt().app.run_on_main_thread(move || {
        let e = rt().engine.lock().unwrap();
        let mut p = rt().presentation.lock().unwrap();
        if e.session.mode == Mode::Inactive
            || e.session.session_id != p.session_id
            || !p.ready(generation, &label)
        {
            return;
        }
        log::info!(
            "Panel layout committed: session={} generation={} panels={} elapsed_ms={}",
            p.session_id,
            p.generation,
            p.panels.len(),
            p.started.map_or(0, |t| t.elapsed().as_millis())
        );
        let search = p.search && e.session.mode == Mode::Search;
        let labels: Vec<_> = p.panels.keys().cloned().collect();
        p.panels.clear();
        drop(p);
        drop(e);
        for label in &labels {
            if let Some(window) = rt().app.get_webview_window(label) {
                platform::show_panel(&window, false);
            }
        }
        if search {
            if let Some(window) = rt().app.get_webview_window("switcher") {
                platform::show_panel(&window, true);
            }
        }
    });
}
fn hide() {
    rt().presentation.lock().unwrap().panels.clear();
    crate::overview_windows::hide(&rt().app);
}
fn perform(action: Action) {
    match action {
        Action::PrepareDisplays(displays) => {
            let anchor = rt().engine.lock().unwrap().snapshot.current_display.clone();
            crate::overview_windows::warm(&rt().app, &displays, &anchor);
        }
        Action::Record(shortcut) => {
            let _ = rt().app.emit("shortcut-recorded", shortcut);
        }
        Action::Publish => {
            let job = rt().engine.lock().unwrap().content_search_request();
            publish();
            if let Some((session_id, request_id, query, context)) = job {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(120));
                    if !rt()
                        .engine
                        .lock()
                        .unwrap()
                        .content_search_current(session_id, request_id, &query)
                    {
                        return;
                    }
                    let result = context.search(&query);
                    let actions = rt()
                        .engine
                        .lock()
                        .unwrap()
                        .content_search_loaded(session_id, request_id, &query, result);
                    dispatch(actions);
                });
            }
        }
        Action::Show => {
            let started = Instant::now();
            let search = rt().engine.lock().unwrap().session.mode == Mode::Search;
            show(search);
            let session_id = rt().engine.lock().unwrap().session.session_id;
            crate::performance::record(
                "show_requested",
                session_id,
                serde_json::json!({"elapsedMs":started.elapsed().as_secs_f64()*1000.}),
            );
        }
        Action::Search => show(true),
        Action::LoadTabs(session_id, origin) => {
            if rt().engine.lock().unwrap().session.session_id != session_id {
                return;
            }
            if platform::focused_id().is_none() {
                let _ = platform::activate(&origin);
            }
            show(false); // Loading is nonactivating: providers must still see their focused window.
            std::thread::spawn(move || {
                let current = || {
                    let e = rt().engine.lock().unwrap();
                    e.session.session_id == session_id
                        && e.session.mode != Mode::Inactive
                        && e.session.loading
                };
                if !current() {
                    return;
                }
                // Search can own focus when changing layers. Restore only that captured origin.
                let home = rt().engine.lock().unwrap().config.codex_home.clone();
                let started = Instant::now();
                let result = if platform::focused_id().as_ref() != Some(&origin.id) {
                    Err(
                        "Focus changed before tabs could be read. Focus the application and retry."
                            .into(),
                    )
                } else {
                    crate::plugins::list(&origin, &home)
                };
                if let Err(error) = &result {
                    log::warn!("Tab inventory failed for {}: {error}", origin.app_id);
                } else if let Ok((items, _)) = &result {
                    log::info!(
                        "Tab inventory ready: session={session_id} app={} count={} elapsed_ms={}",
                        origin.app_id,
                        items.len(),
                        started.elapsed().as_millis()
                    );
                }
                if !current() {
                    return;
                }
                if platform::focused_id().as_ref() != Some(&origin.id) {
                    let mut e = rt().engine.lock().unwrap();
                    let actions = if e.session.session_id == session_id {
                        e.dismiss()
                    } else {
                        vec![]
                    };
                    drop(e);
                    dispatch(actions);
                    return;
                }
                let mut e = rt().engine.lock().unwrap();
                let result = result.map(|(items, search)| {
                    e.content_search = search;
                    items
                });
                let actions = e.tabs_loaded(session_id, result);
                drop(e);
                dispatch(actions);
            });
        }
        Action::Continue(session_id, target, layer) => {
            let focused = platform::focused_id();
            let mut e = rt().engine.lock().unwrap();
            if e.session.session_id != session_id || e.session.mode != Mode::Inactive {
                return;
            }
            if target.desktop_target {
                if !e
                    .snapshot
                    .desktops
                    .iter()
                    .any(|d| d.id == target.desktop_id && d.current)
                {
                    return;
                }
                e.snapshot.focused_id = focused;
            } else if focused.as_ref() != Some(&target.id) {
                e.clear_extension();
                return;
            }
            let actions = e.continue_layer(session_id, target, layer);
            drop(e);
            dispatch(actions);
        }
        Action::ScreenBuoy(session_id, target, held_keys) => {
            std::thread::spawn(move || {
                let current = || {
                    let focused = if target.desktop_target {
                        None
                    } else {
                        platform::focused_id()
                    };
                    let e = rt().engine.lock().unwrap();
                    e.sb_pending
                        && e.config.screen_buoy.enabled
                        && e.session.session_id == session_id
                        && e.session.mode == Mode::Inactive
                        && crate::screen_buoy::target_is_current(
                            &target,
                            &e.snapshot,
                            focused.as_deref(),
                        )
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
                        log::warn!("Screen Buoy handoff failed: session={session_id} target={} desktop={} {error}", target.id, target.desktop_id);
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
            log::info!(
                "Activating destination: session={session_id} target={} desktop={}",
                target.id,
                target.desktop_id
            );
            let result = if target.desktop_target {
                platform::activate_desktop(&target.desktop_id).and_then(|_| {
                    let _inventory = rt().inventory.lock().unwrap();
                    let snapshot = platform::snapshot()?;
                    if !snapshot
                        .desktops
                        .iter()
                        .any(|d| d.id == target.desktop_id && d.current)
                    {
                        return Err("The desktop switch could not be confirmed".into());
                    }
                    rt().engine.lock().unwrap().update(snapshot);
                    Ok(())
                })
            } else if target.content.is_some() {
                platform::activate(&target.native_target())
                    .and_then(|_| crate::plugins::activate(&target))
                    .and_then(|verified| {
                        if !verified {
                            rt().engine.lock().unwrap().clear_extension();
                        }
                        if platform::focused_id().as_ref() != Some(&target.native_target().id) {
                            return Err(
                                "The selected tab did not return to its original window".into()
                            );
                        }
                        Ok(())
                    })
            } else {
                platform::activate(&target)
            };
            match result {
                Ok(()) => {
                    log::info!(
                        "Activated destination: session={session_id} target={}",
                        target.id
                    );
                    rt().engine.lock().unwrap().finish_activation(
                        session_id,
                        if target.desktop_target {
                            platform::focused_id()
                        } else {
                            Some(target.native_target().id)
                        },
                    );
                    publish();
                }
                Err(error) => {
                    log::warn!("Window activation failed: {error}");
                    let focused = platform::focused_id();
                    {
                        let mut e = rt().engine.lock().unwrap();
                        e.clear_extension();
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
pub fn panel_lost_focus() {
    if RUNTIME.get().is_none() {
        return;
    }
    let session_id = rt().engine.lock().unwrap().session.session_id;
    std::thread::spawn(move || {
        // Moving focus between the search fields on two monitors is internal.
        std::thread::sleep(Duration::from_millis(80));
        if rt()
            .app
            .webview_windows()
            .iter()
            .any(|(label, w)| crate::overview::is_panel(label) && w.is_focused().unwrap_or(false))
        {
            return;
        }
        lost_focus(session_id);
    });
}
fn lost_focus(session_id: u64) {
    let mut e = rt().engine.lock().unwrap();
    if e.session.session_id == session_id && e.session.mode == Mode::Search && !e.session.loading {
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
pub fn set_navigation(
    window: tauri::WebviewWindow,
    session_id: u64,
    rectangles: HashMap<String, Bounds>,
) {
    let mut e = rt().engine.lock().unwrap();
    if e.session.session_id != session_id || e.session.mode == Mode::Inactive {
        return;
    }
    if !e.session.overview.is_empty() {
        let panels = e.session.overview.clone();
        crate::overview::merge_navigation(&panels, window.label(), &mut e.navigation, rectangles);
        return;
    }
    if window.label() != "switcher" {
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
        || e.session.layer == Layer::Tabs
    {
        return vec![];
    }
    if e.session.layer == Layer::Desktops {
        let mut seen = std::collections::HashSet::new();
        return e
            .session
            .windows
            .iter()
            .filter_map(|desktop| e.session.desktop_previews.get(&desktop.window.id))
            .flat_map(|preview| &preview.windows)
            .filter(|w| ids.contains(&w.id) && seen.insert(w.id.clone()))
            .take(80)
            .cloned()
            .collect();
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
    let ids: Vec<_> = stale.iter().map(|w| w.id.clone()).collect();
    let lease = rt().capture.claim(ids.iter().cloned());
    // An owner can finish between the first cache check and our claim.
    let stale: Vec<_> = {
        let cache = rt().previews.lock().unwrap();
        stale
            .into_iter()
            .filter(|w| {
                lease.ids.contains(&w.id)
                    && cache
                        .get(&w.id)
                        .is_none_or(|(t, _)| t.elapsed() >= Duration::from_secs(3))
            })
            .collect()
    };
    if !stale.is_empty() {
        let started = Instant::now();
        let images = platform::thumbnails(&stale);
        crate::performance::record(
            "capture",
            0,
            serde_json::json!({"elapsedMs":started.elapsed().as_secs_f64()*1000.,"count":images.len(),"requested":stale.len()}),
        );
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
    drop(lease);
    let waiting = Instant::now();
    rt().capture.wait(&ids, Duration::from_millis(4500));
    crate::performance::record(
        "capture_wait",
        0,
        serde_json::json!({"elapsedMs":waiting.elapsed().as_secs_f64()*1000.,"count":windows.len()}),
    );
    cached_previews(windows)
}
#[tauri::command]
pub async fn get_tab_thumbnails(
    ids: Vec<String>,
    session_id: u64,
) -> Result<HashMap<String, String>, String> {
    let targets = {
        let e = rt().engine.lock().unwrap();
        if !e.config.thumbnails
            || e.session.mode == Mode::Inactive
            || e.session.session_id != session_id
            || e.session.layer != Layer::Tabs
        {
            return Ok(HashMap::new());
        }
        e.session
            .windows
            .iter()
            .filter(|w| ids.contains(&w.window.id))
            .take(8)
            .map(|w| w.window.clone())
            .collect::<Vec<_>>()
    };
    tauri::async_runtime::spawn_blocking(move || crate::plugins::thumbnails(&targets))
        .await
        .map_err(|e| e.to_string())
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
    serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"permissions":platform::permissions(),"previewCount":rt().previews.lock().unwrap().len(),"windowCount":e.snapshot.windows.len(),"displayCount":e.snapshot.displays.len(),"desktopKnown":e.snapshot.windows.iter().filter(|w|w.current_desktop.is_some()).count(),"warnings":e.snapshot.warnings,"configPath":rt().config_path,"sessionMode":e.session.mode,"sessionLayer":e.session.layer,"loading":e.session.loading,"desktopCount":e.snapshot.desktops.len(),"tabApplicationCount":e.tab_apps.len()})
}

#[tauri::command]
pub fn record_shortcut(enabled: bool, single_key: Option<bool>) -> bool {
    RECORD_SINGLE_KEY.store(single_key.unwrap_or(false), Ordering::Release);
    RECORDING.store(enabled, Ordering::Release);
    crate::input::is_ready()
}
#[tauri::command]
pub fn set_live_preview(
    panel: tauri::WebviewWindow,
    id: String,
    session_id: u64,
    bounds: Option<Bounds>,
    hint_bounds: Option<Bounds>,
) -> bool {
    let e = rt().engine.lock().unwrap();
    if e.session.session_id != session_id
        || e.session.mode == Mode::Inactive
        || matches!(e.session.layer, Layer::Tabs | Layer::Desktops)
    {
        return false;
    }
    if e.session.overview.is_empty() {
        if panel.label() != "switcher" {
            return false;
        }
    } else if !e
        .session
        .overview
        .iter()
        .any(|p| p.label == panel.label() && p.slots.iter().flatten().any(|i| i == &id))
    {
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
    platform::live_preview(
        &panel,
        &format!("{session_id}:{}:{id}", panel.label()),
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
    let data = serde_json::json!({"processId":std::process::id(),"permissions":platform::permissions(),"windows":e.snapshot.windows.iter().map(|w|serde_json::json!({"id":w.id,"pid":w.pid,"nativeId":w.native_id,"displayId":w.display_id,"desktopId":w.desktop_id,"currentDesktop":w.current_desktop,"minimized":w.minimized,"hidden":w.hidden})).collect::<Vec<_>>(),"displays":e.snapshot.displays,"focusedId":e.snapshot.focused_id,"sessionMode":e.session.mode,"sessionLayer":e.session.layer,"loading":e.session.loading,"desktops":e.snapshot.desktops,"sessionId":e.session.session_id,"prefix":e.session.prefix,"resultIds":e.session.result_ids,"selected":e.session.selected,"hints":e.session.windows.iter().map(|w|serde_json::json!({"id":w.window.id,"hint":w.hint})).collect::<Vec<_>>(),"warnings":e.snapshot.warnings});
    let _ = std::fs::write(path, serde_json::to_vec_pretty(&data).unwrap());
}
