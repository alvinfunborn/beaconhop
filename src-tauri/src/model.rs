use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Destination {
    pub id: String,
    pub native_id: u64,
    pub pid: u32,
    pub title: String,
    pub app_name: String,
    pub app_id: String,
    pub display_id: String,
    pub desktop_id: String,
    pub desktop_name: String,
    pub current_desktop: Option<bool>,
    pub minimized: bool,
    pub hidden: bool,
    pub bounds: Bounds,
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Display {
    pub id: String,
    pub name: String,
    pub bounds: Bounds,
    pub scale: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Snapshot {
    pub windows: Vec<Destination>,
    pub displays: Vec<Display>,
    pub current_display: String,
    pub focused_id: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HintWindow {
    #[serde(flatten)]
    pub window: Destination,
    pub hint: String,
}

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Inactive,
    Held,
    Search,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub session_id: u64,
    pub revision: u64,
    pub mode: Mode,
    pub windows: Vec<HintWindow>,
    pub result_ids: Vec<String>,
    pub selected: Option<String>,
    pub prefix: String,
    pub query: String,
    pub error: Option<String>,
    pub warnings: Vec<String>,
    pub origin: Option<Destination>,
    pub display: Option<Display>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub required: bool,
    pub accessibility: bool,
    pub input_monitoring: bool,
    pub screen_recording: bool,
    pub keyboard_hook: bool,
    pub ready: bool,
    pub app_path: String,
}
