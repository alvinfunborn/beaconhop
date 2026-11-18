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
    pub content: Option<ContentRef>,
    pub desktop_target: bool,
    pub desktop_label: Option<DesktopLabel>,
}

/// Content semantics choose rendering independently of provider IDs and cache availability.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentPresentation {
    #[default]
    Text,
    Thumbnails,
}

/// Provider IDs are opaque. A tab also retains its exact native parent window.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentRef {
    pub provider: String,
    pub instance: String,
    pub context: String,
    pub item: String,
    pub parent_id: String,
    pub subtitle: String,
    pub active: bool,
    #[serde(default)]
    pub preview: bool,
    #[serde(default)]
    pub presentation: ContentPresentation,
    #[serde(default)]
    pub description: String,
}
impl Destination {
    pub fn native_target(&self) -> Self {
        let mut window = self.clone();
        if let Some(content) = window.content.take() {
            window.id = content.parent_id;
        }
        window
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    #[default]
    Windows,
    Application,
    Tabs,
    Desktops,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Desktop {
    pub id: String,
    pub name: String,
    /// Display used to activate this Space. Shared macOS Spaces still have an anchor.
    pub display_id: String,
    /// Physical displays covered by the overview, when supplied by the platform.
    pub display_ids: Vec<String>,
    pub current: bool,
    pub label: Option<DesktopLabel>,
}

/// Only generated labels are translated. User-named Windows desktops stay intact.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLabel {
    pub number: usize,
    pub full_screen: bool,
}
impl DesktopLabel {
    pub fn chinese(&self) -> String {
        format!(
            "{} {}",
            if self.full_screen {
                "全屏空间"
            } else {
                "桌面"
            },
            self.number
        )
    }
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
    pub desktops: Vec<Desktop>,
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
    pub layer: Layer,
    pub sticky: bool,
    pub loading: bool,
    pub searching: bool,
    pub desktop_filter: Option<String>,
    pub windows: Vec<HintWindow>,
    pub desktop_previews: std::collections::HashMap<String, DesktopPreview>,
    pub result_ids: Vec<String>,
    pub selected: Option<String>,
    pub prefix: String,
    pub query: String,
    pub error: Option<String>,
    pub warnings: Vec<String>,
    pub origin: Option<Destination>,
    pub display: Option<Display>,
    pub overview: Vec<crate::overview::OverviewPanel>,
    /// Native left-to-right Space order within each physical display.
    pub desktops: Vec<Desktop>,
    /// Front to back, from native inventory before MRU or slot ordering.
    pub spatial_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreview {
    pub displays: Vec<Display>,
    pub windows: Vec<Destination>,
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
