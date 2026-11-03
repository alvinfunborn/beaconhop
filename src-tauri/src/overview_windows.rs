use crate::{
    model::Display,
    overview::{display_label, is_panel, OverviewPanel},
    platform,
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub fn backdrop(panel: &WebviewWindow) {
    use tauri::window::{Effect, EffectsBuilder};
    #[cfg(target_os = "macos")]
    let effects = EffectsBuilder::new()
        .effect(Effect::Sidebar)
        .state(tauri::window::EffectState::Active)
        .radius(17.)
        .build();
    #[cfg(target_os = "windows")]
    let effects = EffectsBuilder::new()
        .effect(Effect::Acrylic)
        .color(tauri::window::Color(22, 23, 33, 70))
        .build();
    if let Err(error) = panel.set_effects(effects) {
        log::warn!("Panel backdrop unavailable: {error}");
    }
}

fn ensure(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App("index.html?view=switcher".into()),
    )
    .title("BeaconHop Switcher")
    .inner_size(1000., 640.)
    .visible(false)
    .focused(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .resizable(false)
    .build()?;
    backdrop(&window);
    Ok(window)
}

// Called by the action worker, never inside the native keyboard hook or engine lock.
pub fn warm(app: &AppHandle, displays: &[Display]) {
    for display in displays {
        if let Err(error) = ensure(app, &display_label(&display.id)) {
            log::warn!("Could not prepare display overview: {error}");
        }
    }
    for (label, window) in app.webview_windows() {
        if label.starts_with("switcher-display-")
            && !displays.iter().any(|d| display_label(&d.id) == label)
        {
            let _ = window.destroy();
        }
    }
}

pub fn show(app: &AppHandle, panels: &[OverviewPanel], search: bool) -> tauri::Result<()> {
    // Prepare every screen before exposing any. A failed screen must not leave
    // invisible targets selectable on another screen.
    let windows = panels
        .iter()
        .map(|panel| ensure(app, &panel.label))
        .collect::<tauri::Result<Vec<_>>>()?;
    for (label, window) in app.webview_windows() {
        if is_panel(&label) && !panels.iter().any(|p| p.label == label) {
            let _ = window.hide();
        }
    }
    for (panel, window) in panels.iter().zip(&windows) {
        let b = &panel.bounds;
        #[cfg(target_os = "macos")]
        {
            window.set_size(tauri::LogicalSize::new(b.width, b.height))?;
            window.set_position(tauri::LogicalPosition::new(b.x, b.y))?;
        }
        #[cfg(target_os = "windows")]
        {
            // Position first so the per-monitor DPI is settled before sizing.
            window.set_position(tauri::PhysicalPosition::new(
                b.x.round() as i32,
                b.y.round() as i32,
            ))?;
            window.set_size(tauri::PhysicalSize::new(
                b.width.round() as u32,
                b.height.round() as u32,
            ))?;
        }
    }
    for window in &windows {
        platform::show_panel(window, false);
    }
    if search {
        if let Some(window) = windows.iter().find(|w| w.label() == "switcher") {
            platform::show_panel(window, true);
        }
    }
    Ok(())
}

pub fn hide(app: &AppHandle) {
    platform::clear_previews();
    for (label, window) in app.webview_windows() {
        if is_panel(&label) {
            let _ = window.hide();
        }
    }
}
