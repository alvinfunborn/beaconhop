//! Opt-in timings for the installed app. No window titles or image data.
use std::{
    fs::File,
    io::Write,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::WebviewWindow;

static OUTPUT: OnceLock<Option<Mutex<File>>> = OnceLock::new();

#[tauri::command]
pub fn performance_enabled() -> bool {
    OUTPUT
        .get_or_init(|| {
            std::env::var_os("BEACONHOP_PERFORMANCE_FILE")
                .and_then(|path| File::options().create(true).append(true).open(path).ok())
                .map(Mutex::new)
        })
        .is_some()
}

pub fn record(stage: &str, session_id: u64, detail: serde_json::Value) {
    if !performance_enabled() {
        return;
    }
    let data = serde_json::json!({"atMs":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64()*1000.,
        "stage":stage,"sessionId":session_id,"detail":detail});
    if let Some(output) = OUTPUT.get().and_then(Option::as_ref) {
        if let Ok(mut file) = output.lock() {
            let _ = writeln!(file, "{data}");
        }
    }
}

#[tauri::command]
pub fn record_performance(
    panel: WebviewWindow,
    session_id: u64,
    stage: String,
    elapsed_ms: f64,
    count: usize,
) {
    if !matches!(
        stage.as_str(),
        "session_received"
            | "layout"
            | "overview_frame"
            | "preview_cache"
            | "preview_fresh"
            | "preview_frame"
    ) || !elapsed_ms.is_finite()
        || elapsed_ms < 0.
    {
        return;
    }
    record(
        &stage,
        session_id,
        serde_json::json!({"panel":panel.label(),"elapsedMs":elapsed_ms,"count":count}),
    );
}
