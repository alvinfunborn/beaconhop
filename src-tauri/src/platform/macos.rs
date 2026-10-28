use crate::model::*;
use std::ffi::{c_char, c_void, CStr};
extern "C" {
    fn bh_focused() -> *mut c_char;
    fn bh_snapshot() -> *mut c_char;
    fn bh_activate(pid: i32, id: u32) -> *mut c_char;
    fn bh_thumbnail(id: u32) -> *mut c_char;
    fn bh_free(p: *mut c_char);
    fn bh_screen_permission(request: bool) -> bool;
    fn bh_panel(window: *mut c_void, search: bool);
    fn bh_focus_settings(window: *mut c_void);
}
unsafe fn string(p: *mut c_char) -> Option<String> {
    if p.is_null() {
        None
    } else {
        let s = CStr::from_ptr(p).to_string_lossy().into_owned();
        bh_free(p);
        Some(s)
    }
}
pub fn focused_id() -> Option<String> {
    unsafe { string(bh_focused()) }
}
pub fn snapshot() -> Result<Snapshot, String> {
    let raw = unsafe { string(bh_snapshot()) }.ok_or("Could not enumerate windows")?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
pub fn activate(w: &Destination) -> Result<(), String> {
    match unsafe { string(bh_activate(w.pid as i32, w.native_id as u32)) } {
        None => Ok(()),
        Some(error) => Err(error),
    }
}
pub fn thumbnail(w: &Destination) -> Option<String> {
    unsafe { string(bh_thumbnail(w.native_id as u32)) }
}
pub fn permissions() -> PermissionStatus {
    let accessibility = crate::macos_access::is_accessibility_trusted();
    let input_monitoring = crate::macos_access::has_input_monitoring_access();
    PermissionStatus {
        required: true,
        accessibility,
        input_monitoring,
        screen_recording: unsafe { bh_screen_permission(false) },
        keyboard_hook: crate::input::is_ready(),
        ready: accessibility && crate::input::is_ready(),
        app_path: std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }
}
pub fn request_permission(kind: &str) -> Result<(), String> {
    let pane = match kind {
        "accessibility" => {
            crate::macos_access::request_accessibility();
            "Privacy_Accessibility"
        }
        "input" => {
            crate::macos_access::request_input_monitoring();
            "Privacy_ListenEvent"
        }
        "screen" => {
            unsafe { bh_screen_permission(true) };
            "Privacy_ScreenCapture"
        }
        _ => return Err("Unknown permission".into()),
    };
    // A request may return without showing another prompt after an earlier
    // decision. The button must still take the user to the relevant setting.
    let status = std::process::Command::new("/usr/bin/open")
        .arg(format!(
            "x-apple.systempreferences:com.apple.preference.security?{pane}"
        ))
        .status()
        .map_err(|error| format!("Could not open System Settings: {error}"))?;
    if !status.success() {
        return Err("Could not open System Settings".into());
    }
    log::info!("Opened macOS permission settings: {kind} ({pane})");
    Ok(())
}
pub fn show_panel(window: &tauri::WebviewWindow, search: bool) {
    let window = window.clone();
    let _ = window.clone().run_on_main_thread(move || {
        if let Ok(raw) = window.ns_window() {
            unsafe { bh_panel(raw, search) };
        }
    });
}
pub fn focus_settings(window: &tauri::WebviewWindow) {
    let window = window.clone();
    let _ = window.clone().run_on_main_thread(move || {
        if let Ok(raw) = window.ns_window() {
            unsafe { bh_focus_settings(raw) };
        }
    });
}
pub fn clear_previews() {}
pub fn live_preview(_: &tauri::WebviewWindow, _: &str, _: &Destination, _: Option<Bounds>) -> bool {
    false
}
