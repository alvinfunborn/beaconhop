//! Platform-independent interaction rules. Native hooks never enumerate windows or capture images.
use crate::{
    config::{Config, Scope, Shortcut, SHIFT},
    model::*,
};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub struct KeyEvent {
    pub key: String,
    pub code: u32,
    pub modifiers: u8,
    pub down: bool,
    pub repeat: bool,
}
#[derive(Clone, Debug)]
pub enum Action {
    Record(String),
    Publish,
    PrepareDisplays(Vec<Display>),
    Show,
    Search,
    Activate(u64, Destination),
    ScreenBuoy(u64, Destination, Vec<u32>),
    LoadTabs(u64, Destination),
    Continue(u64, Destination, Layer),
    Cancel(u64, Option<Destination>),
}
#[derive(Default)]
pub struct Response {
    pub consumed: bool,
    pub actions: Vec<Action>,
}
#[derive(Clone, Copy, PartialEq)]
enum Continuation {
    Windows,
    Application,
    Tabs,
    ScreenBuoy,
}
struct HintExtension {
    target: Destination,
    key: String,
    code: u32,
    requested: Option<Continuation>,
}
pub struct Engine {
    pub config: Config,
    pub snapshot: Snapshot,
    pub session: Session,
    pub mru: Vec<String>,
    consumed: HashSet<u32>,
    pressed_keys: HashSet<u32>,
    continuation_keys: HashSet<u32>,
    continuation_modifiers: u8,
    continuation_pending: bool,
    drain_modifiers: u8,
    serial: u64,
    pending_focus: Option<(u64, String)>,
    hint_extension: Option<HintExtension>,
    pub sb_pending: bool,
    pub tab_apps: HashSet<String>,
    tab_hints: HashMap<String, crate::stable_hints::StableHints>,
    tab_mru: Vec<String>,
    load_delta: isize,
    commit_on_load: bool,
    desktop_hints: crate::stable_hints::StableHints,
    desktop_mru: Vec<String>,
    search_index: HashMap<String, crate::search::SearchText>,
    pub hints: crate::stable_hints::StableHints,
    pub navigation: HashMap<String, Bounds>,
    pub overview: crate::overview::StableOverview,
}
impl Engine {
    pub fn clear_extension(&mut self) {
        self.hint_extension = None;
        self.continuation_pending = false;
        self.sb_pending = false;
    }
    pub fn new(config: Config) -> Self {
        Self {
            config,
            snapshot: Snapshot::default(),
            session: Session::default(),
            mru: vec![],
            consumed: HashSet::new(),
            pressed_keys: HashSet::new(),
            continuation_keys: HashSet::new(),
            continuation_modifiers: 0,
            continuation_pending: false,
            drain_modifiers: 0,
            serial: 0,
            pending_focus: None,
            hint_extension: None,
            sb_pending: false,
            tab_apps: HashSet::new(),
            tab_hints: HashMap::new(),
            tab_mru: Vec::new(),
            load_delta: 0,
            commit_on_load: false,
            desktop_hints: Default::default(),
            desktop_mru: Vec::new(),
            search_index: HashMap::new(),
            hints: Default::default(),
            navigation: HashMap::new(),
            overview: Default::default(),
        }
    }
    pub fn observe_focus(&mut self, id: Option<String>) {
        if let Some((_, target)) = &self.pending_focus {
            if id.as_ref() != Some(target) {
                return; // A delayed poll of the origin must not undo a committed hop.
            }
            self.pending_focus = None;
        }
        if self.session.mode != Mode::Inactive {
            return;
        }
        if let Some(ref id) = id {
            self.mru.retain(|x| x != id);
            self.mru.insert(0, id.clone());
        }
        self.snapshot.focused_id = id;
    }
    /// A nonactivating panel must not keep intercepting input after the user changes windows.
    pub fn observe_native_focus(&mut self, id: Option<String>) -> Vec<Action> {
        if self.session.mode != Mode::Inactive
            && (self.session.loading || (self.session.mode == Mode::Held && self.session.sticky))
            && id.is_some()
            && id.as_ref() != self.session.origin.as_ref().map(|w| &w.id)
        {
            let actions = self.dismiss();
            self.observe_focus(id);
            return actions;
        }
        self.observe_focus(id);
        vec![]
    }
    pub fn finish_activation(&mut self, session_id: u64, focused: Option<String>) {
        if self.session.session_id == session_id
            && self.hint_extension.as_ref().is_some_and(|h| {
                focused.as_ref() != Some(&h.target.native_target().id) && !h.target.desktop_target
            })
        {
            self.hint_extension = None;
            self.sb_pending = false;
        }
        if self
            .pending_focus
            .as_ref()
            .is_some_and(|(id, _)| *id == session_id)
        {
            self.pending_focus = None;
        } else if self.pending_focus.is_some() || self.session.session_id != session_id {
            return;
        }
        self.observe_focus(focused);
    }
    pub fn update(&mut self, snapshot: Snapshot) {
        self.overview.retain_displays(&snapshot.displays);
        // Only confirmed Space transitions change desktop recency. Repeated polls
        // and activation requests (which can fail) must not rewrite this history.
        self.desktop_mru
            .retain(|id| snapshot.desktops.iter().any(|d| &d.id == id));
        for desktop in snapshot.desktops.iter().filter(|d| d.current) {
            if !self
                .snapshot
                .desktops
                .iter()
                .any(|old| old.id == desktop.id && old.current)
            {
                self.desktop_mru.retain(|id| id != &desktop.id);
                self.desktop_mru.insert(0, desktop.id.clone());
            }
        }
        self.observe_focus(snapshot.focused_id.clone());
        let live: HashSet<_> = snapshot.windows.iter().map(|w| &w.id).collect();
        self.mru.retain(|id| live.contains(id));
        self.search_index.retain(|id, _| live.contains(id));
        for w in &snapshot.windows {
            let source = format!("{} {} {}", w.app_name, w.title, w.app_id);
            if self
                .search_index
                .get(&w.id)
                .is_none_or(|index| index.source != source)
            {
                self.search_index
                    .insert(w.id.clone(), crate::search::SearchText::new(source));
            }
        }
        self.hints.sync(
            &self.config,
            &snapshot
                .windows
                .iter()
                .map(|w| w.id.clone())
                .collect::<Vec<_>>(),
        );
        self.snapshot = snapshot;
    }
    pub fn open(&mut self, mode: Mode, reverse: bool) -> Vec<Action> {
        self.open_layer(Layer::Windows, mode, reverse, false, None)
    }
    pub fn focused_window(&self) -> Option<Destination> {
        self.pending_focus
            .as_ref()
            .map(|(_, id)| id)
            .or(self.snapshot.focused_id.as_ref())
            .and_then(|id| self.snapshot.windows.iter().find(|w| &w.id == id))
            .cloned()
    }
    pub fn supports_tabs(&self, target: &Destination) -> bool {
        self.config.tabs_enabled
            && self
                .tab_apps
                .contains(&crate::plugins::app_key(&target.app_id))
    }
    fn shortcut_layer(&self, event: &KeyEvent) -> Option<(Layer, Mode)> {
        let origin = if self.session.mode == Mode::Inactive {
            self.focused_window()
        } else {
            self.session.origin.clone()
        };
        for (layer, enabled, hold, search) in [
            (
                Layer::Desktops,
                self.config.desktops_enabled && !self.snapshot.desktops.is_empty(),
                &self.config.desktops_hold_shortcut,
                &self.config.desktops_search_shortcut,
            ),
            (
                Layer::Windows,
                self.config.hold_enabled,
                &self.config.hold_shortcut,
                &self.config.search_shortcut,
            ),
            (
                Layer::Application,
                self.config.application_enabled && origin.is_some(),
                &self.config.application_hold_shortcut,
                &self.config.application_search_shortcut,
            ),
            (
                Layer::Tabs,
                origin.as_ref().is_some_and(|o| self.supports_tabs(o)),
                &self.config.tabs_hold_shortcut,
                &self.config.tabs_search_shortcut,
            ),
        ] {
            if !enabled {
                continue;
            }
            if !event.repeat
                && Shortcut::parse(search)
                    .unwrap()
                    .matches(&event.key, event.modifiers, false)
            {
                return Some((layer, Mode::Search));
            }
            if Shortcut::parse(hold)
                .unwrap()
                .matches(&event.key, event.modifiers, true)
            {
                return Some((layer, Mode::Held));
            }
        }
        // The all-window search remains available when hold-to-switch is disabled.
        if !event.repeat
            && Shortcut::parse(&self.config.search_shortcut)
                .unwrap()
                .matches(&event.key, event.modifiers, false)
        {
            return Some((Layer::Windows, Mode::Search));
        }
        None
    }
    pub fn tabs_loaded(
        &mut self,
        session_id: u64,
        result: Result<Vec<Destination>, String>,
    ) -> Vec<Action> {
        if self.session.session_id != session_id
            || self.session.mode == Mode::Inactive
            || !self.session.loading
        {
            return vec![];
        }
        self.session.loading = false;
        self.session.revision += 1;
        match result {
            Err(error) => {
                self.session.error = Some(error);
                self.session.mode = Mode::Search;
                self.clear_extension();
            }
            Ok(mut items) => {
                let ranks: HashMap<_, _> = self
                    .tab_mru
                    .iter()
                    .enumerate()
                    .map(|(i, id)| (id, i))
                    .collect();
                items.sort_by_key(|w| ranks.get(&w.id).copied().unwrap_or(usize::MAX));
                let context = items
                    .first()
                    .and_then(|w| w.content.as_ref())
                    .map(|c| format!("{}:{}:{}", c.provider, c.instance, c.context))
                    .unwrap_or_default();
                if self.tab_hints.len() > 128 && !self.tab_hints.contains_key(&context) {
                    self.tab_hints.clear();
                }
                let hints = self.tab_hints.entry(context).or_default();
                hints.sync(
                    &self.config,
                    &items.iter().map(|w| w.id.clone()).collect::<Vec<_>>(),
                );
                let active = items
                    .iter()
                    .position(|w| w.content.as_ref().is_some_and(|c| c.active));
                let delta = if self.session.mode == Mode::Held && !self.session.sticky {
                    self.load_delta
                } else {
                    0
                };
                self.session.selected = if items.is_empty() {
                    None
                } else {
                    Some(
                        items[(active
                            .map(|i| i as isize)
                            .unwrap_or(if delta > 0 { -1 } else { 0 })
                            + delta)
                            .rem_euclid(items.len() as isize)
                            as usize]
                            .id
                            .clone(),
                    )
                };
                self.session.windows = items
                    .into_iter()
                    .map(|window| HintWindow {
                        hint: hints.get(&window.id),
                        window,
                    })
                    .collect();
                if self.commit_on_load {
                    return self.activate(None);
                }
            }
        }
        vec![Action::Show, Action::Publish]
    }
    pub fn continue_layer(
        &mut self,
        session_id: u64,
        target: Destination,
        layer: Layer,
    ) -> Vec<Action> {
        if !self.continuation_pending
            || self.session.session_id != session_id
            || self.session.mode != Mode::Inactive
        {
            return vec![];
        }
        self.open_layer(layer, Mode::Held, false, true, Some(target))
    }
    pub fn open_layer(
        &mut self,
        layer: Layer,
        mode: Mode,
        reverse: bool,
        sticky: bool,
        target: Option<Destination>,
    ) -> Vec<Action> {
        self.clear_extension();
        self.serial += 1;
        let desktop_filter = target
            .as_ref()
            .filter(|t| t.desktop_target)
            .map(|t| t.desktop_id.clone());
        let desktop_display = target
            .as_ref()
            .filter(|t| t.desktop_target && !t.display_id.is_empty())
            .map(|t| t.display_id.clone());
        let origin = target
            .filter(|t| !t.desktop_target)
            .or_else(|| self.focused_window())
            .filter(|w| {
                desktop_filter
                    .as_ref()
                    .is_none_or(|id| &w.desktop_id == id && w.current_desktop == Some(true))
            });
        self.load_delta = if reverse { -1 } else { 1 };
        self.commit_on_load = false;
        let current = origin
            .as_ref()
            .map(|w| w.display_id.as_str())
            .or(desktop_display.as_deref())
            .unwrap_or(&self.snapshot.current_display);
        let excluded: HashSet<_> = self
            .config
            .excluded_apps
            .iter()
            .map(|a| a.to_lowercase())
            .collect();
        let mut windows: Vec<_> = self
            .snapshot
            .windows
            .iter()
            .filter(|w| {
                !matches!(layer, Layer::Tabs | Layer::Desktops)
                    && desktop_filter.as_ref().is_none_or(|id| &w.desktop_id == id)
                    && (layer != Layer::Application
                        || origin.as_ref().is_some_and(|o| same_application(o, w)))
                    && (self.config.desktop_scope == Scope::All || w.current_desktop == Some(true))
                    && (self.config.display_scope == Scope::All || w.display_id == current)
                    && (self.config.include_minimized || !w.minimized)
                    && (self.config.include_hidden || !w.hidden)
                    && !excluded.contains(&w.app_name.to_lowercase())
                    && !excluded.contains(&w.app_id.to_lowercase())
            })
            .cloned()
            .collect();
        let spatial_ids = windows
            .iter()
            .filter(|w| !w.minimized && !w.hidden && w.current_desktop == Some(true))
            .map(|w| w.id.clone())
            .collect();
        let ranks: HashMap<_, _> = self.mru.iter().enumerate().map(|(i, id)| (id, i)).collect();
        windows.sort_by_key(|w| ranks.get(&w.id).copied().unwrap_or(usize::MAX));
        let display = self
            .snapshot
            .displays
            .iter()
            .find(|d| d.id == current)
            .or_else(|| self.snapshot.displays.first())
            .cloned();
        let overview = if layer == Layer::Windows {
            let displays: Vec<_> = self
                .snapshot
                .displays
                .iter()
                .filter(|d| {
                    self.config.display_scope == Scope::All
                        || display.as_ref().is_some_and(|anchor| anchor.id == d.id)
                })
                .cloned()
                .collect();
            let panels = self.overview.prepare(
                &displays,
                &windows,
                display.as_ref().map_or("", |d| d.id.as_str()),
            );
            if !panels.is_empty() {
                let order: HashMap<_, _> = panels
                    .iter()
                    .flat_map(|p| p.slots.iter().flatten())
                    .enumerate()
                    .map(|(i, id)| (id, i))
                    .collect();
                windows.sort_by_key(|w| order.get(&w.id).copied().unwrap_or(usize::MAX));
            }
            panels
        } else {
            vec![]
        };
        self.hints.sync(
            &self.config,
            &self
                .snapshot
                .windows
                .iter()
                .map(|w| w.id.clone())
                .collect::<Vec<_>>(),
        );
        self.navigation.clear();
        let mut desktop_previews = HashMap::new();
        if layer == Layer::Desktops {
            for desktop in &self.snapshot.desktops {
                desktop_previews.insert(
                    format!("desktop:{}", desktop.id),
                    DesktopPreview {
                        displays: self
                            .snapshot
                            .displays
                            .iter()
                            .filter(|d| {
                                if desktop.display_ids.is_empty() {
                                    desktop.display_id.is_empty() || d.id == desktop.display_id
                                } else {
                                    desktop.display_ids.contains(&d.id)
                                }
                            })
                            .cloned()
                            .collect(),
                        windows: self
                            .snapshot
                            .windows
                            .iter()
                            .filter(|w| {
                                w.desktop_id == desktop.id
                                    && !w.minimized
                                    && !w.hidden
                                    && !excluded.contains(&w.app_name.to_lowercase())
                                    && !excluded.contains(&w.app_id.to_lowercase())
                            })
                            .cloned()
                            .collect(),
                    },
                );
            }
            windows = self
                .snapshot
                .desktops
                .iter()
                .map(|d| Destination {
                    id: format!("desktop:{}", d.id),
                    desktop_id: d.id.clone(),
                    title: d.name.clone(),
                    app_name: "Desktop".into(),
                    display_id: d.display_id.clone(),
                    current_desktop: Some(d.current),
                    desktop_target: true,
                    desktop_label: d.label.clone(),
                    ..Destination::default()
                })
                .collect();
            self.desktop_hints.sync(
                &self.config,
                &windows.iter().map(|w| w.id.clone()).collect::<Vec<_>>(),
            );
        }
        let items: Vec<_> = windows
            .into_iter()
            .map(|window| {
                let hint = if layer == Layer::Desktops {
                    self.desktop_hints.get(&window.id)
                } else {
                    self.hints.get(&window.id)
                };
                HintWindow { window, hint }
            })
            .collect();
        let selected = if items.is_empty() {
            None
        } else if layer == Layer::Desktops && mode == Mode::Held {
            let current = items
                .iter()
                .position(|w| {
                    w.window.current_desktop == Some(true)
                        && self.snapshot.desktops.iter().any(|d| {
                            d.id == w.window.desktop_id
                                && (d.display_id.is_empty()
                                    || d.display_id == current
                                    || d.display_ids.iter().any(|id| id == current))
                        })
                })
                .or_else(|| {
                    items
                        .iter()
                        .position(|w| w.window.current_desktop == Some(true))
                })
                .unwrap_or(0);
            // Keep overview positions and hints stable; use recency for the first
            // forward selection, then Tab/Shift+Tab continue in overview order.
            let recent = (!reverse)
                .then(|| {
                    self.desktop_mru.iter().find_map(|id| {
                        items.iter().position(|w| {
                            &w.window.desktop_id == id && w.window.current_desktop != Some(true)
                        })
                    })
                })
                .flatten();
            let index = recent.unwrap_or_else(|| {
                (current as isize + if reverse { -1 } else { 1 }).rem_euclid(items.len() as isize)
                    as usize
            });
            Some(items[index].window.id.clone())
        } else if !overview.is_empty() {
            let origin_id = origin.as_ref().map(|w| &w.id);
            let current_index = items.iter().position(|w| Some(&w.window.id) == origin_id);
            let recent = self.mru.iter().find_map(|id| {
                items
                    .iter()
                    .position(|w| &w.window.id == id && Some(id) != origin_id)
            });
            let index = if mode != Mode::Held {
                current_index.unwrap_or(0)
            } else if reverse {
                (current_index.unwrap_or(0) + items.len() - 1) % items.len()
            } else {
                recent.unwrap_or_else(|| current_index.map_or(0, |i| (i + 1) % items.len()))
            };
            Some(items[index].window.id.clone())
        } else {
            let index = if mode == Mode::Held && items.len() > 1 {
                if reverse {
                    items.len() - 1
                } else if origin.as_ref().map(|o| &o.id) == Some(&items[0].window.id)
                    || (layer == Layer::Desktops && items[0].window.current_desktop == Some(true))
                {
                    1
                } else {
                    0
                }
            } else {
                0
            };
            Some(items[index].window.id.clone())
        };
        self.session = Session {
            session_id: self.serial,
            revision: 1,
            mode,
            layer,
            sticky,
            loading: layer == Layer::Tabs,
            desktop_filter,
            windows: items,
            desktop_previews,
            selected,
            origin,
            display,
            overview,
            desktops: self.snapshot.desktops.clone(),
            spatial_ids,
            warnings: self.snapshot.warnings.clone(),
            ..Session::default()
        };
        if layer == Layer::Tabs {
            if let Some(origin) = self.session.origin.clone() {
                return vec![Action::LoadTabs(self.serial, origin), Action::Publish];
            }
            return self.tabs_loaded(self.serial, Err("No focused window".into()));
        }
        vec![Action::Show, Action::Publish]
    }
    pub fn navigate(&mut self, delta: isize) {
        if self.session.loading {
            self.load_delta += delta;
            return;
        }
        let ids: Vec<_> = self.results().iter().map(|w| w.window.id.clone()).collect();
        if ids.is_empty() {
            self.session.selected = None;
            return;
        }
        let index = self
            .session
            .selected
            .as_ref()
            .and_then(|id| ids.iter().position(|i| i == id))
            .unwrap_or(0);
        self.session.selected =
            Some(ids[(index as isize + delta).rem_euclid(ids.len() as isize) as usize].clone());
        self.session.revision += 1;
    }
    pub fn navigate_direction(&mut self, direction: &str) {
        if !matches!(
            direction,
            "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
        ) {
            return;
        }
        let target = self
            .session
            .selected
            .as_ref()
            .and_then(|id| self.navigation.get(id))
            .and_then(|rect| {
                crate::navigation::neighbor(
                    rect,
                    self.results().into_iter().filter_map(|w| {
                        self.navigation
                            .get(&w.window.id)
                            .map(|b| (w.window.id.as_str(), b))
                    }),
                    direction,
                )
            });
        if let Some(id) = target {
            self.session.selected = Some(id);
            self.session.revision += 1;
        }
    }

    pub fn results(&self) -> Vec<&HintWindow> {
        self.session
            .windows
            .iter()
            .filter_map(|w| {
                if !w.hint.starts_with(&self.session.prefix) {
                    return None;
                }
                self.search_index
                    .get(&w.window.id)
                    .map_or_else(
                        || {
                            score(
                                &format!(
                                    "{} {} {}",
                                    w.window.app_name,
                                    w.window.title,
                                    format!(
                                        "{} {} {}",
                                        w.window.app_id,
                                        w.window
                                            .content
                                            .as_ref()
                                            .map(|c| format!("{} {}", c.subtitle, c.description))
                                            .unwrap_or_default(),
                                        w.window
                                            .desktop_label
                                            .as_ref()
                                            .map(|label| label.chinese())
                                            .unwrap_or_default()
                                    )
                                ),
                                &self.session.query,
                            )
                        },
                        |index| index.score(&self.session.query),
                    )
                    .map(|_| w)
            })
            .collect()
    }
    pub fn search(&mut self, query: String) {
        self.session.query = query;
        self.session.prefix.clear();
        let selected = self.results().first().map(|w| w.window.id.clone());
        self.session.selected = selected;
        self.session.revision += 1;
    }
    pub fn activate(&mut self, id: Option<&str>) -> Vec<Action> {
        if self.session.loading {
            self.commit_on_load = true;
            return vec![];
        }
        let id = id
            .map(str::to_owned)
            .or_else(|| self.session.selected.clone());
        let target = id
            .and_then(|id| self.session.windows.iter().find(|w| w.window.id == id))
            .map(|w| w.window.clone());
        let Some(target) = target else {
            return if self.session.mode == Mode::Held {
                self.cancel()
            } else {
                vec![]
            };
        };
        // Validate against the newest inventory. Never reuse a closed window's code or native handle.
        if if target.desktop_target {
            !self
                .snapshot
                .desktops
                .iter()
                .any(|d| d.id == target.desktop_id)
        } else {
            !self
                .snapshot
                .windows
                .iter()
                .any(|w| w.id == target.native_target().id && w.pid == target.pid)
        } {
            self.session.error =
                Some("That window has closed. Open BeaconHop again to refresh.".into());
            self.session.revision += 1;
            self.session.mode = Mode::Search;
            return vec![Action::Publish, Action::Search];
        }
        self.session.mode = Mode::Inactive;
        self.session.selected = Some(target.id.clone());
        self.session.revision += 1;
        let native_id = target.native_target().id;
        if !target.desktop_target {
            let mru = if target.content.is_some() {
                &mut self.tab_mru
            } else {
                &mut self.mru
            };
            mru.retain(|id| id != &target.id);
            mru.insert(0, target.id.clone());
        }
        self.pending_focus = if target.desktop_target {
            None
        } else {
            Some((self.session.session_id, native_id))
        };
        vec![Action::Activate(self.session.session_id, target)]
    }
    pub fn cancel(&mut self) -> Vec<Action> {
        let origin = self.session.origin.clone();
        self.dismiss();
        vec![Action::Cancel(self.session.session_id, origin)]
    }
    pub fn dismiss(&mut self) -> Vec<Action> {
        self.clear_extension();
        self.pending_focus = None;
        self.commit_on_load = false;
        self.session.loading = false;
        self.session.mode = Mode::Inactive;
        self.session.revision += 1;
        vec![Action::Cancel(self.session.session_id, None)]
    }
    pub fn handle(&mut self, mut event: KeyEvent) -> Response {
        let mut response = Response::default();
        if event.down {
            self.pressed_keys.insert(event.code);
        } else {
            self.pressed_keys.remove(&event.code);
        }
        if !event.down && self.consumed.remove(&event.code) {
            response.consumed = true;
        }
        // A continuation owns the old gesture until each physical key is released.
        // Modifier events still reach the OS, whose corresponding downs passed through.
        self.continuation_modifiers &= event.modifiers;
        if self.continuation_keys.contains(&event.code) {
            if !event.down {
                self.continuation_keys.remove(&event.code);
            }
            response.consumed |=
                !matches!(event.key.as_str(), "Alt" | "Control" | "Super" | "Shift");
            return response;
        }
        // Still-held modifiers from the previous layer must not turn fresh Tab or
        // punctuation input into a different shortcut or hint in the new layer.
        event.modifiers &= !self.continuation_modifiers;
        if event.down && (!event.repeat || !self.consumed.contains(&event.code)) {
            let was_pending = self.sb_pending;
            self.sb_pending = false;
            if was_pending && !matches!(event.key.as_str(), "Alt" | "Control" | "Super" | "Shift") {
                // Input during the handoff cancels it, just like BH-to-BH
                // continuation. Never send that first attempted hint/command
                // into the selected application's editor while SB is loading.
                self.consumed.insert(event.code);
                response.consumed = true;
                return response;
            }
        }
        if self.continuation_pending {
            if event.down
                && !event.repeat
                && !matches!(event.key.as_str(), "Alt" | "Control" | "Super" | "Shift")
            {
                self.clear_extension();
                self.consumed.insert(event.code);
                response.consumed = true;
            }
            return response;
        }
        if self.session.loading && event.down && event.key == "Escape" {
            response.actions = self.cancel();
            self.consumed.insert(event.code);
            response.consumed = true;
            return response;
        }
        if self.session.loading
            && self.commit_on_load
            && event.down
            && !event.repeat
            && !matches!(event.key.as_str(), "Alt" | "Control" | "Super" | "Shift")
        {
            // A quick Ctrl+Tab must not switch later in the middle of subsequent typing.
            response.actions = self.dismiss();
            return response;
        }
        if event.down
            && event.repeat
            && self.session.mode == Mode::Inactive
            && self.consumed.contains(&event.code)
        {
            response.consumed = true;
            return response;
        }
        let hold = Shortcut::parse(&self.config.hold_shortcut).expect("validated configuration");
        let layer = self.session.layer;
        let hold = match layer {
            Layer::Windows => hold,
            Layer::Application => Shortcut::parse(&self.config.application_hold_shortcut).unwrap(),
            Layer::Tabs => Shortcut::parse(&self.config.tabs_hold_shortcut).unwrap(),
            Layer::Desktops => Shortcut::parse(&self.config.desktops_hold_shortcut).unwrap(),
        };
        if !self.config.screen_buoy.enabled
            && !self.config.hold_enabled
            && !self.config.application_enabled
            && !self.config.tabs_enabled
        {
            self.hint_extension = None;
        }
        if let Some(extension) = &mut self.hint_extension {
            if event.key == "Escape" && event.down {
                self.hint_extension = None;
                self.consumed.insert(event.code);
                response.consumed = true;
                return response;
            }
            if extension.requested.is_none() {
                if !event.down && event.code == extension.code {
                    self.hint_extension = None;
                } else if event.down
                    && !event.repeat
                    && continuation(&self.config, &self.tab_apps, extension, &event.key).is_some()
                {
                    extension.requested =
                        continuation(&self.config, &self.tab_apps, extension, &event.key);
                } else if event.down
                    && !event.repeat
                    && event.code != extension.code
                    && !matches!(event.key.as_str(), "Alt" | "Control" | "Super" | "Shift")
                {
                    self.hint_extension = None;
                }
            } else if event.down && !event.repeat && !self.consumed.contains(&event.code) {
                self.hint_extension = None;
            }
            if self
                .hint_extension
                .as_ref()
                .is_some_and(|h| h.requested.is_some())
            {
                if !matches!(event.key.as_str(), "Alt" | "Control" | "Super" | "Shift") {
                    response.consumed = true;
                    if event.down {
                        self.consumed.insert(event.code);
                    }
                }
                // Both destinations start on keydown. SB drains the physical keys
                // itself; BH isolates them before its next layer can receive input.
                {
                    let extension = self.hint_extension.take().unwrap();
                    let target = extension.target.native_target();
                    self.drain_modifiers = 0;
                    match extension.requested.unwrap() {
                        Continuation::ScreenBuoy => {
                            self.sb_pending = true;
                            response.actions.push(Action::ScreenBuoy(
                                self.session.session_id,
                                target,
                                self.pressed_keys.iter().copied().collect(),
                            ));
                        }
                        kind => {
                            self.continuation_keys.clone_from(&self.pressed_keys);
                            self.continuation_modifiers |= event.modifiers;
                            self.continuation_pending = true;
                            response.actions.push(Action::Continue(
                                self.session.session_id,
                                target,
                                match kind {
                                    Continuation::Tabs => Layer::Tabs,
                                    Continuation::Windows => Layer::Windows,
                                    _ => Layer::Application,
                                },
                            ));
                        }
                    }
                }
                return response;
            }
        }
        if self.drain_modifiers != 0 {
            if event.modifiers & self.drain_modifiers == 0 {
                self.drain_modifiers = 0;
            } else if !matches!(event.key.as_str(), "Alt" | "Control" | "Super" | "Shift") {
                response.consumed = true;
                if event.down {
                    self.consumed.insert(event.code);
                }
                return response;
            }
        }
        if self.session.mode == Mode::Held
            && !self.session.sticky
            // A chord remains held until all of its modifiers are released.
            // Remappers can temporarily release Ctrl while translating Ctrl+A
            // to Cmd+A. Committing on that first release selected the highlighted
            // desktop before its A hint could reach us.
            && event.modifiers & hold.modifiers == 0
        {
            response.actions = if self.session.prefix.is_empty() {
                self.activate(None)
            } else {
                self.cancel()
            };
            return response;
        }
        if !event.down {
            return response;
        }
        let requested = self.shortcut_layer(&event);
        if let Some((layer, mode)) = requested {
            response.consumed = true;
            if self.session.mode != Mode::Inactive && self.session.layer == layer {
                if mode == Mode::Search {
                    self.commit_on_load = false;
                    self.session.mode = mode;
                    self.session.sticky = false;
                    self.session.prefix.clear();
                    self.session.revision += 1;
                    if !self.session.loading {
                        response.actions.push(Action::Search);
                    }
                } else {
                    self.session.prefix.clear();
                    self.navigate(if event.modifiers & SHIFT != 0 { -1 } else { 1 });
                }
                response.actions.push(Action::Publish);
            } else {
                let origin = if self.session.mode != Mode::Inactive {
                    self.session.origin.clone()
                } else {
                    None
                };
                response.actions =
                    self.open_layer(layer, mode, event.modifiers & SHIFT != 0, false, origin);
            }
        } else if self.session.loading && self.session.mode == Mode::Search {
            response.consumed =
                !matches!(event.key.as_str(), "Alt" | "Control" | "Super" | "Shift");
        } else if self.session.mode == Mode::Held {
            match event.key.as_str() {
                "Alt" | "Control" | "Super" | "Shift" => return response,
                "Escape" => {
                    response.actions = self.cancel();
                    self.drain_modifiers = hold.modifiers;
                }
                key if key
                    == crate::config::parse_search_entry_key(&self.config.search_entry_key)
                        .expect("validated configuration") =>
                {
                    self.session.mode = Mode::Search;
                    self.commit_on_load = false;
                    self.session.sticky = false;
                    self.session.prefix.clear();
                    self.session.revision += 1;
                    response.actions = if self.session.loading {
                        vec![Action::Publish]
                    } else {
                        vec![Action::Search, Action::Publish]
                    };
                }
                "Tab" => {
                    self.session.prefix.clear();
                    self.navigate(if event.modifiers & SHIFT != 0 { -1 } else { 1 });
                    response.actions.push(Action::Publish);
                }
                "ArrowLeft" | "ArrowUp" | "ArrowRight" | "ArrowDown" => {
                    self.session.prefix.clear();
                    self.navigate_direction(&event.key);
                    response.actions.push(Action::Publish);
                }
                "Enter" => {
                    response.actions = self.activate(None);
                    self.drain_modifiers = hold.modifiers;
                }
                "Backspace" => {
                    self.session.prefix.pop();
                    self.session.revision += 1;
                    response.actions.push(Action::Publish);
                }
                key if crate::config::hint_character(key, event.modifiers)
                    .is_some_and(|c| self.config.hint_contains(c))
                    && !event.repeat =>
                {
                    let character = crate::config::hint_character(key, event.modifiers).unwrap();
                    let candidate = format!("{}{}", self.session.prefix, character);
                    if self
                        .session
                        .windows
                        .iter()
                        .any(|w| w.hint.starts_with(&candidate))
                    {
                        self.session.prefix = candidate;
                        let exact = self
                            .session
                            .windows
                            .iter()
                            .find(|w| w.hint == self.session.prefix)
                            .map(|w| w.window.id.clone());
                        if let Some(id) = exact {
                            response.actions = self.activate(Some(&id));
                            self.drain_modifiers = hold.modifiers;
                            if self.config.screen_buoy.enabled
                                || self.config.hold_enabled
                                || self.config.application_enabled
                                || self.config.tabs_enabled
                            {
                                if let Some(Action::Activate(_, target)) = response.actions.first()
                                {
                                    self.hint_extension = Some(HintExtension {
                                        target: target.clone(),
                                        key: event.key.clone(),
                                        code: event.code,
                                        requested: None,
                                    });
                                }
                            }
                        } else {
                            self.session.selected =
                                self.results().first().map(|w| w.window.id.clone());
                            self.session.revision += 1;
                            response.actions.push(Action::Publish);
                        }
                    }
                }
                _ => {}
            }
            response.consumed = true;
        }
        if response.consumed {
            self.consumed.insert(event.code);
        }
        response
    }
}

pub fn score(text: &str, query: &str) -> Option<i64> {
    crate::search::SearchText::new(text.into()).score(query)
}

fn same_application(a: &Destination, b: &Destination) -> bool {
    if a.app_id.is_empty() || b.app_id.is_empty() {
        a.pid == b.pid
    } else {
        a.app_id.eq_ignore_ascii_case(&b.app_id)
    }
}
fn continuation(
    config: &Config,
    apps: &HashSet<String>,
    extension: &HintExtension,
    key: &str,
) -> Option<Continuation> {
    if key == extension.key {
        return None;
    }
    let matches = |bindings: &[String]| {
        bindings.iter().any(|binding| {
            crate::hint_keys::binding_key(binding, &extension.key, &config.screen_buoy.neighbours)
                .as_deref()
                == Some(key)
        })
    };
    if config.hold_enabled && matches(&config.windows_hint_keys) {
        return Some(Continuation::Windows);
    }
    if config.application_enabled && matches(&config.application_hint_keys) {
        return Some(Continuation::Application);
    }
    if config.tabs_enabled
        && apps.contains(&crate::plugins::app_key(&extension.target.app_id))
        && matches(&config.tabs_hint_keys)
    {
        return Some(Continuation::Tabs);
    }
    if config.screen_buoy.matches(&extension.key, key) {
        return Some(Continuation::ScreenBuoy);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ALT;
    #[test]
    fn localized_application_can_be_found_by_bundle_name_and_only_explicit_exclusions_apply() {
        let mut e = engine(1);
        let mut snapshot = e.snapshot.clone();
        snapshot.windows[0].app_name = "访达".into();
        snapshot.windows[0].app_id = "com.apple.finder".into();
        snapshot.windows[0].title = "下载".into();
        e.update(snapshot);
        for query in ["Finder", "访达", "fangda", "fd", "下载", "xiazai"] {
            e.open(Mode::Search, false);
            e.search(query.into());
            assert_eq!(e.results().len(), 1, "{query}");
        }
        let mut snapshot = e.snapshot.clone();
        snapshot.windows[0].app_id = "com.example.files".into();
        e.update(snapshot);
        e.open(Mode::Search, false);
        e.search("finder".into());
        assert!(e.results().is_empty());
        e.config.excluded_apps = vec!["com.example.files".into()];
        e.open(Mode::Search, false);
        e.search("访达".into());
        assert!(e.results().is_empty());
    }
    #[test]
    fn exact_phrase_outranks_reused_word_fragments() {
        let query = "BeaconHop QA B";
        assert!(
            score("macos-fixture BeaconHop QA B", query)
                > score("macos-fixture BeaconHop QA A", query)
        );
    }
    fn engine(count: usize) -> Engine {
        let mut e = Engine::new(Config {
            hold_shortcut: "Alt+Tab".into(),
            application_enabled: false,
            tabs_enabled: false,
            ..Config::default()
        });
        e.update(Snapshot {
            focused_id: Some("0".into()),
            current_display: "a".into(),
            windows: (0..count)
                .map(|i| Destination {
                    id: i.to_string(),
                    pid: 1,
                    title: format!("工作 {i}"),
                    app_name: "Editor".into(),
                    display_id: if i % 2 == 0 { "a" } else { "b" }.into(),
                    current_desktop: Some(i % 3 == 0),
                    ..Destination::default()
                })
                .collect(),
            ..Snapshot::default()
        });
        e
    }
    fn key(key: &str, mods: u8, down: bool) -> KeyEvent {
        KeyEvent {
            key: key.into(),
            code: key.bytes().map(u32::from).sum(),
            modifiers: mods,
            down,
            repeat: false,
        }
    }
    #[test]
    fn complete_hint_commits_immediately_and_drains_key_releases() {
        let mut e = engine(5);
        e.handle(key("Tab", ALT, true));
        let h = e.session.windows[3].hint.clone();
        let r = e.handle(key(&h, ALT, true));
        assert!(matches!(&r.actions[0],Action::Activate(_, w) if w.id=="3"));
        assert_eq!(e.session.mode, Mode::Inactive);
        assert!(e.handle(key(&h, ALT, false)).consumed);
    }
    fn extension_engine(binding: &str) -> (Engine, String) {
        let mut e = engine(5);
        e.config.screen_buoy.enabled = true;
        e.config.screen_buoy.keys = vec![binding.into()];
        e.handle(key("Tab", ALT, true));
        e.handle(key("Tab", ALT, false));
        let hint = e.session.windows[3].hint.clone();
        let response = e.handle(key(&hint, ALT, true));
        assert!(matches!(&response.actions[..], [Action::Activate(_, target)] if target.id == "3"));
        assert_eq!(e.session.mode, Mode::Inactive);
        (e, hint)
    }
    #[test]
    fn extensions_start_on_keydown_and_isolate_the_held_gesture() {
        for binding in ["HintLeftKey", "HintRightKey", "Enter", "Tab"] {
            for modifier_first in [false, true] {
                let (mut e, hint) = extension_engine(binding);
                let side = &e.config.screen_buoy.neighbours[&hint];
                let trigger = match binding {
                    "HintLeftKey" => side.left.clone().unwrap(),
                    "HintRightKey" => side.right.clone().unwrap(),
                    _ => binding.into(),
                };
                // Record an actually-held modifier as native hooks do.
                e.handle(key("Alt", ALT, true));
                if modifier_first {
                    e.handle(key("Alt", 0, false));
                }
                let mods = if modifier_first { 0 } else { ALT };
                let response = e.handle(key(&trigger, mods, true));
                assert!(response.consumed);
                let [Action::ScreenBuoy(_, target, held)] = &response.actions[..] else {
                    panic!("{binding} must hand off on keydown, before any release");
                };
                assert_eq!(target.id, "3");
                assert!(held.contains(&key(&hint, mods, true).code));
                assert!(held.contains(&key(&trigger, mods, true).code));
                assert_eq!(held.contains(&key("Alt", ALT, true).code), !modifier_first);
                assert!(e.sb_pending);
                for k in [&hint, &trigger] {
                    let mut repeat = key(k, mods, true);
                    repeat.repeat = true;
                    let r = e.handle(repeat);
                    assert!(r.consumed && r.actions.is_empty());
                    assert!(e.sb_pending, "origin repeat must not cancel a cold launch");
                }
                for k in [&trigger, &hint] {
                    let r = e.handle(key(k, mods, false));
                    assert!(r.consumed && r.actions.is_empty());
                }
                assert!(e.handle(key("Alt", 0, false)).actions.is_empty());
                assert!(e.sb_pending);
                e.handle(key("Escape", 0, true));
                assert!(!e.sb_pending);
            }
        }
    }
    #[test]
    fn ordinary_release_escape_unrelated_input_and_failed_focus_never_open_sb() {
        for cancel in [
            "release",
            "Escape",
            "unrelated",
            "failed",
            "open",
            "disable",
        ] {
            let (mut e, hint) = extension_engine("Enter");
            match cancel {
                "release" => {
                    e.handle(key(&hint, ALT, false));
                }
                "Escape" => {
                    e.handle(key("Escape", ALT, true));
                    e.handle(key("Escape", ALT, false));
                }
                "unrelated" => {
                    e.handle(key("1", ALT, true));
                    e.handle(key("1", ALT, false));
                }
                "failed" => e.finish_activation(e.session.session_id, Some("0".into())),
                "open" => {
                    e.open(Mode::Search, false);
                }
                _ => e.config.screen_buoy.enabled = false,
            }
            for event in [
                key("Enter", ALT, true),
                key("Enter", ALT, false),
                key(&hint, ALT, false),
                key("Alt", 0, false),
            ] {
                assert!(
                    !e.handle(event)
                        .actions
                        .iter()
                        .any(|a| matches!(a, Action::ScreenBuoy(..))),
                    "{cancel}"
                );
            }
        }
    }
    #[test]
    fn requested_extension_is_cancelled_by_unrelated_input() {
        let (mut e, hint) = extension_engine("Enter");
        e.handle(key("Enter", ALT, true));
        assert!(e.handle(key("1", ALT, true)).consumed);
        let mut repeat = key("1", ALT, true);
        repeat.repeat = true;
        assert!(e.handle(repeat).consumed);
        assert!(e.handle(key("1", ALT, false)).consumed);
        for event in [
            key("1", ALT, false),
            key("Enter", ALT, false),
            key(&hint, ALT, false),
            key("Alt", 0, false),
        ] {
            assert!(e.handle(event).actions.is_empty());
        }
        assert!(!e.sb_pending);
    }
    #[test]
    fn holding_final_hint_after_modifier_release_does_not_type_repeats_into_target() {
        let (mut e, hint) = extension_engine("Enter");
        e.handle(key("Alt", 0, false));
        let mut repeat = key(&hint, 0, true);
        repeat.repeat = true;
        let response = e.handle(repeat);
        assert!(response.consumed && response.actions.is_empty());
        let response = e.handle(key("Enter", 0, true));
        assert!(response.consumed);
        assert!(matches!(
            response.actions.as_slice(),
            [Action::ScreenBuoy(..)]
        ));
        assert!(e.handle(key("Enter", 0, false)).consumed);
        assert!(e.handle(key(&hint, 0, false)).actions.is_empty());
    }
    #[test]
    fn punctuation_shifted_symbols_and_spaces_activate_short_hints() {
        for (character, name, modifiers) in [
            (';', ";", ALT),
            ('\\', "Backslash", ALT),
            (' ', "Space", ALT),
            ('?', "/", ALT | SHIFT),
            ('!', "1", ALT | SHIFT),
            ('|', "Backslash", ALT | SHIFT),
            ('"', "'", ALT | SHIFT),
            ('+', "=", ALT | SHIFT),
            ('~', "Backquote", ALT | SHIFT),
        ] {
            let mut e = engine(10);
            e.config.search_entry_key = "9".into();
            e.config.hint_alphabet = format!("AS{character}");
            e.config.validate().unwrap();
            e.open(Mode::Held, false);
            assert_eq!(
                e.session
                    .windows
                    .iter()
                    .filter(|w| !w.hint.is_empty())
                    .count(),
                9
            );
            assert_eq!(e.session.windows.len(), 10); // Capacity must never hide a window.
            let target = e
                .session
                .windows
                .iter()
                .find(|w| w.hint == format!("A{character}"))
                .unwrap()
                .window
                .id
                .clone();
            let first = e.handle(key("A", ALT, true));
            assert!(first.consumed);
            assert_eq!(e.session.mode, Mode::Held);
            let result = e.handle(key(name, modifiers, true));
            assert!(
                matches!(&result.actions[0], Action::Activate(_, w) if w.id == target),
                "{character}"
            );
            assert!(e.handle(key(name, modifiers, false)).consumed);
        }
    }
    #[test]
    fn backquote_search_survives_modifier_release() {
        let mut e = engine(4);
        e.handle(key("Tab", ALT, true));
        assert!(e.handle(key("Backquote", ALT, true)).consumed);
        assert_eq!(e.session.mode, Mode::Search);
        assert!(e.handle(key("Backquote", ALT, false)).consumed);
        assert!(e.handle(key("Alt", 0, false)).actions.is_empty());
        assert!(!e.handle(key("A", 0, true)).consumed);
    }
    #[test]
    fn custom_search_entry_only_applies_while_holding() {
        let mut e = engine(4);
        e.config.search_entry_key = "Backslash".into();
        assert!(!e.handle(key("Backslash", 0, true)).consumed);
        assert_eq!(e.session.mode, Mode::Inactive);
        e.handle(key("Tab", ALT, true));
        e.handle(key("Backquote", ALT, true));
        assert_eq!(e.session.mode, Mode::Held);
        assert!(e.handle(key("Backslash", ALT, true)).consumed);
        assert_eq!(e.session.mode, Mode::Search);
        assert!(e.handle(key("Backslash", ALT, false)).consumed);
        assert!(e.handle(key("Alt", 0, false)).actions.is_empty());
    }
    #[test]
    fn configured_backslash_search_leaves_plain_typing_alone() {
        let mut e = engine(4);
        e.config.search_shortcut = "Win+\\".into();
        assert!(!e.handle(key("Backslash", 0, true)).consumed);
        assert_eq!(e.session.mode, Mode::Inactive);
        let response = e.handle(key("Backslash", crate::config::SUPER, true));
        assert!(response.consumed);
        assert_eq!(e.session.mode, Mode::Search);
        assert!(e.handle(key("Backslash", 0, false)).consumed);
    }
    #[test]
    fn normal_release_commits_previous_window() {
        let mut e = engine(4);
        e.handle(key("Tab", ALT, true));
        let r = e.handle(key("Alt", 0, false));
        assert!(matches!(&r.actions[0],Action::Activate(_, w) if w.id=="1"));
    }
    #[test]
    fn reverse_cycle_and_escape_follow_every_configured_modifier_combination() {
        use crate::config::{CTRL, SUPER};
        for (shortcut, trigger, modifiers, released) in [
            ("Alt+Tab", "Tab", ALT, "Alt"),
            ("Ctrl+Space", "Space", CTRL, "Control"),
            ("Super+Tab", "Tab", SUPER, "Super"),
            ("Ctrl+Alt+Space", "Space", CTRL | ALT, "Control"),
            ("Ctrl+Alt+Super+Tab", "Tab", CTRL | ALT | SUPER, "Super"),
        ] {
            let mut e = engine(4);
            e.config.hold_shortcut = shortcut.into();
            e.config.validate().unwrap();
            assert!(e.handle(key(trigger, modifiers | SHIFT, true)).consumed);
            assert_eq!(e.session.selected.as_deref(), Some("3"));
            e.handle(key(trigger, modifiers | SHIFT, false));
            e.handle(key(trigger, modifiers | SHIFT, true));
            assert_eq!(e.session.selected.as_deref(), Some("2"));
            e.handle(key(trigger, modifiers | SHIFT, false));
            e.handle(key("Shift", modifiers, false));
            assert_eq!(e.session.mode, Mode::Held);
            e.handle(key(trigger, modifiers, true));
            assert_eq!(e.session.selected.as_deref(), Some("3"));
            let cancel = e.handle(key("Escape", modifiers, true));
            assert!(matches!(&cancel.actions[0], Action::Cancel(_, Some(w)) if w.id == "0"));
            assert!(e.handle(key(released, 0, false)).actions.is_empty());
            e.handle(key(trigger, modifiers | SHIFT, true));
            let commit = e.handle(key(released, 0, false));
            assert!(matches!(&commit.actions[0], Action::Activate(_, w) if w.id == "3"));
            e.open(Mode::Search, false);
            let origin = e.session.origin.clone().unwrap();
            let cancel = e.cancel();
            assert!(matches!(&cancel[0], Action::Cancel(_, Some(w)) if w.id == origin.id));
        }
    }
    #[test]
    fn rapid_roundtrip_uses_committed_target_until_native_focus_catches_up() {
        let mut e = engine(2);
        e.open(Mode::Held, false);
        let first = e.session.session_id;
        e.activate(None);
        e.observe_focus(Some("0".into())); // Older foreground poll arrives late.
        e.open(Mode::Held, false);
        assert_eq!(e.session.origin.as_ref().unwrap().id, "1");
        assert_eq!(e.session.selected.as_deref(), Some("0"));
        let second = e.session.session_id;
        e.activate(None);
        e.finish_activation(first, Some("1".into())); // Older completion cannot replace the newer hop.
        assert_eq!(e.pending_focus.as_ref().unwrap().1, "0");
        e.finish_activation(second, Some("0".into()));
        assert!(e.pending_focus.is_none());
        assert_eq!(e.snapshot.focused_id.as_deref(), Some("0"));
    }
    #[test]
    fn failed_activation_reconciles_with_actual_foreground() {
        let mut e = engine(2);
        e.open(Mode::Held, false);
        let serial = e.session.session_id;
        e.activate(None);
        e.finish_activation(serial, Some("0".into()));
        e.open(Mode::Held, false);
        assert_eq!(e.session.origin.as_ref().unwrap().id, "0");
        assert_eq!(e.session.selected.as_deref(), Some("1"));
    }
    #[test]
    fn incomplete_hint_release_cancels() {
        let mut e = engine(30);
        e.handle(key("Tab", ALT, true));
        let first = e
            .session
            .windows
            .iter()
            .find(|w| w.hint.len() > 1)
            .unwrap()
            .hint[..1]
            .to_string();
        e.handle(key(&first, ALT, true));
        assert!(matches!(
            &e.handle(key("Alt", 0, false)).actions[0],
            Action::Cancel(_, _)
        ));
    }
    #[test]
    fn scopes_are_independent_and_intersect() {
        let mut e = engine(12);
        e.config.desktop_scope = Scope::Current;
        e.config.display_scope = Scope::Current;
        e.open(Mode::Held, false);
        assert_eq!(
            e.session
                .windows
                .iter()
                .map(|w| w.window.id.as_str())
                .collect::<Vec<_>>(),
            ["0", "6"]
        );
    }
    #[test]
    fn hints_follow_identity_across_mru_scope_and_inventory_changes() {
        let mut e = engine(5);
        e.open(Mode::Held, false);
        let before: HashMap<_, _> = e
            .session
            .windows
            .iter()
            .map(|w| (w.window.id.clone(), w.hint.clone()))
            .collect();
        e.session.mode = Mode::Inactive;
        e.observe_focus(Some("4".into()));
        let mut snapshot = e.snapshot.clone();
        snapshot.windows.reverse();
        snapshot.windows[0].title = "Renamed".into();
        e.update(snapshot);
        e.config.display_scope = Scope::Current;
        e.open(Mode::Held, false);
        for w in &e.session.windows {
            assert_eq!(before[&w.window.id], w.hint);
        }
    }
    #[test]
    fn window_overview_uses_recent_first_then_stable_cross_display_order() {
        let mut e = engine(6);
        e.snapshot.displays = vec![
            Display {
                id: "a".into(),
                bounds: Bounds {
                    x: -1440.,
                    y: 0.,
                    width: 1440.,
                    height: 900.,
                },
                scale: 1.,
                ..Default::default()
            },
            Display {
                id: "b".into(),
                bounds: Bounds {
                    x: 0.,
                    y: 0.,
                    width: 1920.,
                    height: 1080.,
                },
                scale: 1.,
                ..Default::default()
            },
        ];
        e.open(Mode::Held, false);
        let original: Vec<_> = e
            .session
            .windows
            .iter()
            .map(|w| (w.window.id.clone(), w.hint.clone()))
            .collect();
        assert_eq!(
            original.iter().map(|w| w.0.as_str()).collect::<Vec<_>>(),
            ["0", "2", "4", "1", "3", "5"]
        );
        e.dismiss();
        for id in ["1", "5", "2"] {
            e.observe_focus(Some(id.into()));
        }
        e.snapshot.windows.reverse();
        e.open(Mode::Held, false);
        assert_eq!(e.session.selected.as_deref(), Some("5"));
        assert_eq!(
            e.session
                .windows
                .iter()
                .map(|w| (w.window.id.clone(), w.hint.clone()))
                .collect::<Vec<_>>(),
            original
        );
        e.navigate(1);
        assert_eq!(e.session.selected.as_deref(), Some("0"));
        e.navigate(1);
        assert_eq!(e.session.selected.as_deref(), Some("2"));
        e.navigate(-1);
        assert_eq!(e.session.selected.as_deref(), Some("0"));
        e.dismiss();
        e.open(Mode::Held, true);
        assert_eq!(e.session.selected.as_deref(), Some("0"));
        // Search and partial hints filter targets but never change saved slots.
        let slots = e.session.overview[0].slots.clone();
        e.session.prefix = e
            .session
            .windows
            .iter()
            .find(|w| w.window.id == "5")
            .unwrap()
            .hint
            .clone();
        assert_eq!(e.results().len(), 1);
        assert_eq!(e.results()[0].window.id, "5");
        assert_eq!(e.session.overview[0].slots, slots);
        let action = e.activate(Some("5"));
        assert!(
            matches!(action.first(),Some(Action::Activate(_,w)) if w.id=="5" && w.display_id=="b")
        );
        e.finish_activation(e.session.session_id, Some("5".into()));
        e.open(Mode::Held, false);
        assert_eq!(e.session.selected.as_deref(), Some("2"));
        e.dismiss();
        e.config.display_scope = Scope::Current;
        e.open(Mode::Held, false);
        assert_eq!(e.session.overview.len(), 1);
        assert!(e.session.windows.iter().all(|w| w.window.display_id == "b"));
        assert_eq!(e.session.selected.as_deref(), Some("1"));
    }
    #[test]
    fn window_session_keeps_native_desktop_order_independent_of_recency_and_search() {
        let mut e = engine(4);
        e.snapshot.desktops = ["9", "2", "17"]
            .iter()
            .enumerate()
            .map(|(i, id)| Desktop {
                id: (*id).into(),
                name: format!("Space {i}"),
                display_id: "a".into(),
                display_ids: vec!["a".into(), "b".into()],
                current: i == 1,
                label: Some(DesktopLabel {
                    number: i + 1,
                    full_screen: i == 1,
                }),
            })
            .collect();
        e.observe_focus(Some("3".into()));
        e.open(Mode::Search, false);
        e.search("工作 2".into());
        let serialized = serde_json::to_value(&e.session).unwrap();
        assert_eq!(
            serialized["desktops"]
                .as_array()
                .unwrap()
                .iter()
                .map(|d| d["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["9", "2", "17"]
        );
        assert_eq!(serialized["desktops"][1]["label"]["fullScreen"], true);
        assert_eq!(serialized["desktops"][1]["current"], true);
        assert_eq!(
            serialized["desktops"][0]["displayIds"],
            serde_json::json!(["a", "b"])
        );
    }
    #[test]
    fn spatial_snapshot_preserves_native_stack_and_excludes_nonvisible_windows() {
        let mut e = engine(6);
        for w in &mut e.snapshot.windows {
            w.current_desktop = Some(true);
        }
        e.snapshot.windows[1].minimized = true;
        e.snapshot.windows[2].hidden = true;
        e.snapshot.windows[3].current_desktop = Some(false);
        e.snapshot.windows[4].current_desktop = None;
        e.snapshot.windows.reverse(); // Native stack, independent of preview order.
        e.open(Mode::Held, false);
        assert_eq!(e.session.spatial_ids, ["5", "0"]);
        assert_eq!(e.session.windows.len(), 6); // All remain selectable in the preview area.
        e.dismiss();
        e.observe_focus(Some("5".into()));
        e.open(Mode::Held, false);
        assert_eq!(e.session.spatial_ids, ["5", "0"]);
    }
    #[test]
    fn held_arrow_keys_use_the_visible_card_geometry_and_do_not_leak() {
        let mut e = engine(4);
        e.open(Mode::Held, false);
        e.session.selected = Some("0".into());
        e.navigation = (0..4)
            .map(|i| {
                (
                    i.to_string(),
                    Bounds {
                        x: (i % 2) as f64 * 200.,
                        y: (i / 2) as f64 * 120.,
                        width: 180.,
                        height: 100.,
                    },
                )
            })
            .collect();
        for (direction, wanted) in [
            ("ArrowRight", "1"),
            ("ArrowDown", "3"),
            ("ArrowLeft", "2"),
            ("ArrowUp", "0"),
        ] {
            let response = e.handle(key(direction, ALT, true));
            assert!(response.consumed);
            assert_eq!(e.session.selected.as_deref(), Some(wanted));
            assert!(e.handle(key(direction, ALT, false)).consumed);
        }
    }
    #[test]
    fn directional_edges_do_not_wrap_through_tab_order() {
        let mut e = engine(3);
        e.open(Mode::Held, false);
        e.session.selected = Some("1".into());
        e.navigation = (0..3)
            .map(|i| {
                (
                    i.to_string(),
                    Bounds {
                        x: i as f64 * 200.,
                        y: 0.,
                        width: 180.,
                        height: 100.,
                    },
                )
            })
            .collect();
        e.navigate_direction("ArrowDown");
        assert_eq!(e.session.selected.as_deref(), Some("1"));
        e.navigate_direction("ArrowRight");
        assert_eq!(e.session.selected.as_deref(), Some("2"));
        e.navigate_direction("ArrowRight");
        assert_eq!(e.session.selected.as_deref(), Some("2"));
        e.navigate(1);
        assert_eq!(e.session.selected.as_deref(), Some("0")); // Tab still cycles.
    }
    #[test]
    fn expanding_to_two_keys_cannot_change_an_open_overview() {
        let mut e = engine(26);
        e.open(Mode::Held, false);
        let target = e
            .session
            .windows
            .iter()
            .find(|w| w.hint == "M")
            .unwrap()
            .window
            .id
            .clone();
        let before: Vec<_> = e
            .session
            .windows
            .iter()
            .map(|w| (w.window.id.clone(), w.hint.clone()))
            .collect();
        e.update(engine(27).snapshot);
        assert_ne!(e.hints.get(&target), "M");
        assert_eq!(
            before,
            e.session
                .windows
                .iter()
                .map(|w| (w.window.id.clone(), w.hint.clone()))
                .collect::<Vec<_>>()
        );
        let result = e.handle(key("M", ALT, true));
        assert!(matches!(&result.actions[0], Action::Activate(_, w) if w.id == target));
        e.open(Mode::Held, false);
        assert_eq!(e.session.windows.len(), 27);
        assert!(e
            .session
            .windows
            .iter()
            .all(|w| (1..=2).contains(&w.hint.len())));
    }

    #[test]
    fn hints_are_stable_and_closed_targets_cannot_be_reused() {
        let mut e = engine(30);
        e.open(Mode::Held, false);
        let before = e
            .session
            .windows
            .iter()
            .map(|w| w.hint.clone())
            .collect::<Vec<_>>();
        let mut snapshot = e.snapshot.clone();
        snapshot.windows.retain(|w| w.id != "5");
        e.update(snapshot);
        assert_eq!(
            before,
            e.session
                .windows
                .iter()
                .map(|w| w.hint.clone())
                .collect::<Vec<_>>()
        );
        assert!(matches!(&e.activate(Some("5"))[0], Action::Publish));
        assert!(e.session.error.is_some());
    }
    #[test]
    fn search_handles_unicode_and_multiple_words() {
        assert!(score("编辑器 产品设计", "产品").is_some());
        assert!(score("Visual Studio Code", "vsc").is_some());
        assert!(score("Terminal BeaconHop", "term beacon").is_some());
        assert_eq!(score("Terminal", "xyzz"), None);
    }

    #[test]
    fn pinyin_index_tracks_renamed_and_closed_windows_without_changing_mru() {
        let mut e = engine(3);
        let mut snapshot = e.snapshot.clone();
        snapshot.windows[0].title = "微信 产品设计".into();
        snapshot.windows[1].title = "微信 重庆银行".into();
        e.update(snapshot);
        e.observe_focus(Some("1".into()));
        e.open(Mode::Search, false);
        e.search("wx".into());
        assert_eq!(
            e.results()
                .iter()
                .map(|w| w.window.id.as_str())
                .collect::<Vec<_>>(),
            ["1", "0"]
        );
        e.session.mode = Mode::Inactive;
        let mut snapshot = e.snapshot.clone();
        snapshot.windows[0].title = "项目计划".into();
        snapshot.windows.retain(|w| w.id != "1");
        e.update(snapshot);
        e.open(Mode::Search, false);
        e.search("wx".into());
        assert!(e.results().is_empty());
        e.search("xmjh".into());
        assert_eq!(e.results()[0].window.id, "0");
        assert!(!e.search_index.contains_key("1"));
    }

    #[test]
    fn external_focus_changes_and_search_keep_recent_windows_first() {
        let mut e = engine(5);
        for id in ["4", "2", "3"] {
            e.observe_focus(Some(id.into()));
        }
        // Native inventory/Z-order changes must not replace observed usage order.
        let mut snapshot = e.snapshot.clone();
        snapshot.windows.reverse();
        e.update(snapshot);
        e.open(Mode::Search, false);
        assert_eq!(
            e.results()
                .iter()
                .map(|w| w.window.id.as_str())
                .collect::<Vec<_>>(),
            ["3", "2", "4", "0", "1"]
        );
        e.session.windows[0].window.title = "other 工作 context".into();
        e.session.windows[1].window.title = "工作".into();
        e.search("工作".into());
        assert_eq!(
            e.results()
                .iter()
                .map(|w| w.window.id.as_str())
                .collect::<Vec<_>>(),
            ["3", "2", "4", "0", "1"]
        );
    }
}

#[cfg(test)]
mod edge_tests {
    use super::*;
    use crate::config::ALT;
    #[test]
    fn empty_inventory_release_exits_hold_mode() {
        let mut e = Engine::new(Config {
            hold_shortcut: "Alt+Tab".into(),
            application_enabled: false,
            tabs_enabled: false,
            ..Config::default()
        });
        e.open(Mode::Held, false);
        let r = e.handle(KeyEvent {
            key: "Alt".into(),
            code: 58,
            modifiers: 0,
            down: false,
            repeat: false,
        });
        assert_eq!(e.session.mode, Mode::Inactive);
        assert!(matches!(r.actions.first(), Some(Action::Cancel(_, _))));
    }
    #[test]
    fn failed_release_enters_recoverable_search() {
        let mut e = Engine::new(Config {
            hold_shortcut: "Alt+Tab".into(),
            application_enabled: false,
            tabs_enabled: false,
            ..Config::default()
        });
        let w = Destination {
            id: "a".into(),
            pid: 1,
            ..Destination::default()
        };
        e.snapshot.windows.push(w);
        e.open(Mode::Held, false);
        e.snapshot.windows.clear();
        e.handle(KeyEvent {
            key: "Alt".into(),
            code: 58,
            modifiers: 0,
            down: false,
            repeat: false,
        });
        assert_eq!(e.session.mode, Mode::Search);
        assert!(e.session.error.is_some());
    }
    #[test]
    fn repeat_cannot_submit_a_two_letter_hint() {
        let mut e = Engine::new(Config {
            hold_shortcut: "Alt+Tab".into(),
            application_enabled: false,
            tabs_enabled: false,
            ..Config::default()
        });
        e.snapshot.windows = (0..30)
            .map(|i| Destination {
                id: i.to_string(),
                ..Destination::default()
            })
            .collect();
        e.open(Mode::Held, false);
        let prefix = e
            .session
            .windows
            .iter()
            .find(|w| w.hint.len() > 1)
            .unwrap()
            .hint[..1]
            .to_string();
        e.handle(KeyEvent {
            key: prefix.clone(),
            code: 0,
            modifiers: ALT,
            down: true,
            repeat: false,
        });
        e.handle(KeyEvent {
            key: prefix.clone(),
            code: 0,
            modifiers: ALT,
            down: true,
            repeat: true,
        });
        assert_eq!(e.session.mode, Mode::Held);
        assert_eq!(e.session.prefix, prefix);
    }
}

#[cfg(test)]
#[path = "engine_layers.rs"]
mod layer_tests;
