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
    Show,
    Search,
    Activate(u64, Destination),
    Cancel(u64, Option<Destination>),
}
#[derive(Default)]
pub struct Response {
    pub consumed: bool,
    pub actions: Vec<Action>,
}
pub struct Engine {
    pub config: Config,
    pub snapshot: Snapshot,
    pub session: Session,
    pub mru: Vec<String>,
    consumed: HashSet<u32>,
    drain_modifiers: u8,
    serial: u64,
    pending_focus: Option<(u64, String)>,
}
impl Engine {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            snapshot: Snapshot::default(),
            session: Session::default(),
            mru: vec![],
            consumed: HashSet::new(),
            drain_modifiers: 0,
            serial: 0,
            pending_focus: None,
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
    pub fn finish_activation(&mut self, session_id: u64, focused: Option<String>) {
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
        self.observe_focus(snapshot.focused_id.clone());
        let live: HashSet<_> = snapshot.windows.iter().map(|w| &w.id).collect();
        self.mru.retain(|id| live.contains(id));
        self.snapshot = snapshot;
    }
    pub fn open(&mut self, mode: Mode, reverse: bool) -> Vec<Action> {
        self.serial += 1;
        let origin = self
            .pending_focus
            .as_ref()
            .map(|(_, id)| id)
            .or(self.snapshot.focused_id.as_ref())
            .and_then(|id| self.snapshot.windows.iter().find(|w| &w.id == id))
            .cloned();
        let current = origin
            .as_ref()
            .map(|w| w.display_id.as_str())
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
                (self.config.desktop_scope == Scope::All || w.current_desktop == Some(true))
                    && (self.config.display_scope == Scope::All || w.display_id == current)
                    && (self.config.include_minimized || !w.minimized)
                    && (self.config.include_hidden || !w.hidden)
                    && !excluded.contains(&w.app_name.to_lowercase())
                    && !excluded.contains(&w.app_id.to_lowercase())
            })
            .cloned()
            .collect();
        let ranks: HashMap<_, _> = self.mru.iter().enumerate().map(|(i, id)| (id, i)).collect();
        windows.sort_by_key(|w| ranks.get(&w.id).copied().unwrap_or(usize::MAX));
        let letters: Vec<_> = self.config.hint_alphabet.chars().collect();
        let mut length = 1;
        while letters.len().pow(length) < windows.len() {
            length += 1;
        }
        let codes = crate::codes::generate(&vec![letters; length as usize], &[]);
        let items: Vec<_> = windows
            .into_iter()
            .zip(codes)
            .map(|(window, hint)| HintWindow { window, hint })
            .collect();
        let selected = if items.is_empty() {
            None
        } else {
            let index = if mode == Mode::Held && items.len() > 1 {
                if reverse {
                    items.len() - 1
                } else if origin.as_ref().map(|o| &o.id) == Some(&items[0].window.id) {
                    1
                } else {
                    0
                }
            } else {
                0
            };
            Some(items[index].window.id.clone())
        };
        let display = self
            .snapshot
            .displays
            .iter()
            .find(|d| d.id == current)
            .cloned();
        self.session = Session {
            session_id: self.serial,
            revision: 1,
            mode,
            windows: items,
            selected,
            origin,
            display,
            warnings: self.snapshot.warnings.clone(),
            ..Session::default()
        };
        vec![Action::Show, Action::Publish]
    }
    pub fn navigate(&mut self, delta: isize) {
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
    pub fn results(&self) -> Vec<&HintWindow> {
        let mut items: Vec<_> = self
            .session
            .windows
            .iter()
            .filter_map(|w| {
                if !w.hint.starts_with(&self.session.prefix) {
                    return None;
                }
                score(
                    &format!("{} {}", w.window.app_name, w.window.title),
                    &self.session.query,
                )
                .map(|s| (w, s))
            })
            .collect();
        items.sort_by_key(|(_, s)| std::cmp::Reverse(*s));
        items.into_iter().map(|(w, _)| w).collect()
    }
    pub fn search(&mut self, query: String) {
        self.session.query = query;
        self.session.prefix.clear();
        let selected = self.results().first().map(|w| w.window.id.clone());
        self.session.selected = selected;
        self.session.revision += 1;
    }
    pub fn activate(&mut self, id: Option<&str>) -> Vec<Action> {
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
        if !self
            .snapshot
            .windows
            .iter()
            .any(|w| w.id == target.id && w.pid == target.pid)
        {
            self.session.error =
                Some("That window has closed. Open BeaconHop again to refresh.".into());
            self.session.revision += 1;
            self.session.mode = Mode::Search;
            return vec![Action::Publish, Action::Search];
        }
        self.session.mode = Mode::Inactive;
        self.session.selected = Some(target.id.clone());
        self.session.revision += 1;
        self.mru.retain(|id| id != &target.id);
        self.mru.insert(0, target.id.clone());
        self.pending_focus = Some((self.session.session_id, target.id.clone()));
        vec![Action::Activate(self.session.session_id, target)]
    }
    pub fn cancel(&mut self) -> Vec<Action> {
        let origin = self.session.origin.clone();
        self.pending_focus = None;
        self.session.mode = Mode::Inactive;
        self.session.revision += 1;
        vec![Action::Cancel(self.session.session_id, origin)]
    }
    pub fn handle(&mut self, event: KeyEvent) -> Response {
        let mut response = Response::default();
        if !event.down && self.consumed.remove(&event.code) {
            response.consumed = true;
        }
        let hold = Shortcut::parse(&self.config.hold_shortcut).expect("validated configuration");
        let search =
            Shortcut::parse(&self.config.search_shortcut).expect("validated configuration");
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
        if self.session.mode == Mode::Held && event.modifiers & hold.modifiers != hold.modifiers {
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
        if search.matches(&event.key, event.modifiers, false) && !event.repeat {
            response.actions = if self.session.mode == Mode::Inactive {
                self.open(Mode::Search, false)
            } else {
                self.session.mode = Mode::Search;
                self.session.prefix.clear();
                self.session.revision += 1;
                vec![Action::Search, Action::Publish]
            };
            response.consumed = true;
        } else if self.config.hold_enabled && hold.matches(&event.key, event.modifiers, true) {
            response.consumed = true;
            if self.session.mode == Mode::Inactive {
                response.actions = self.open(Mode::Held, event.modifiers & SHIFT != 0);
            } else {
                self.session.prefix.clear();
                self.navigate(if event.modifiers & SHIFT != 0 { -1 } else { 1 });
                response.actions.push(Action::Publish);
            }
        } else if self.session.mode == Mode::Held {
            match event.key.as_str() {
                "Alt" | "Control" | "Super" | "Shift" => return response,
                "Escape" => {
                    response.actions = self.cancel();
                    self.drain_modifiers = hold.modifiers;
                }
                "Backslash" => {
                    self.session.mode = Mode::Search;
                    self.session.prefix.clear();
                    self.session.revision += 1;
                    response.actions = vec![Action::Search, Action::Publish];
                }
                "Tab" | "ArrowRight" | "ArrowDown" => {
                    self.session.prefix.clear();
                    self.navigate(if event.modifiers & SHIFT != 0 { -1 } else { 1 });
                    response.actions.push(Action::Publish);
                }
                "ArrowLeft" | "ArrowUp" => {
                    self.session.prefix.clear();
                    self.navigate(-1);
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
                key if key.len() == 1
                    && self.config.hint_alphabet.contains(key)
                    && !event.repeat =>
                {
                    let candidate = format!("{}{}", self.session.prefix, key);
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
    let hay = text.to_lowercase();
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Some(0);
    }
    // A full title/phrase match outranks independently matching its words elsewhere.
    let mut total = hay.find(&needle).map(|i| 10_000 - i as i64).unwrap_or(0);
    for word in needle.split_whitespace() {
        if let Some(i) = hay.find(word) {
            total += 1000 - i as i64;
            continue;
        }
        let mut chars = hay.char_indices();
        let mut last = 0;
        for c in word.chars() {
            let (i, _) = chars.find(|(_, h)| *h == c)?;
            total += 10 - (i - last) as i64;
            last = i;
        }
    }
    Some(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ALT;
    #[test]
    fn exact_phrase_outranks_reused_word_fragments() {
        let query = "BeaconHop QA B";
        assert!(
            score("macos-fixture BeaconHop QA B", query)
                > score("macos-fixture BeaconHop QA A", query)
        );
    }
    fn engine(count: usize) -> Engine {
        let mut e = Engine::new(Config::default());
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
    #[test]
    fn backslash_search_survives_modifier_release() {
        let mut e = engine(4);
        e.handle(key("Tab", ALT, true));
        e.handle(key("Backslash", ALT, true));
        assert_eq!(e.session.mode, Mode::Search);
        assert!(e.handle(key("Alt", 0, false)).actions.is_empty());
        assert!(!e.handle(key("A", 0, true)).consumed);
    }
    #[test]
    fn normal_release_commits_previous_window() {
        let mut e = engine(4);
        e.handle(key("Tab", ALT, true));
        let r = e.handle(key("Alt", 0, false));
        assert!(matches!(&r.actions[0],Action::Activate(_, w) if w.id=="1"));
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
        let first = e.session.windows[0].hint[..1].to_string();
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
}

#[cfg(test)]
mod edge_tests {
    use super::*;
    use crate::config::ALT;
    #[test]
    fn empty_inventory_release_exits_hold_mode() {
        let mut e = Engine::new(Config::default());
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
        let mut e = Engine::new(Config::default());
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
        let mut e = Engine::new(Config::default());
        e.snapshot.windows = (0..30)
            .map(|i| Destination {
                id: i.to_string(),
                ..Destination::default()
            })
            .collect();
        e.open(Mode::Held, false);
        e.handle(KeyEvent {
            key: "A".into(),
            code: 0,
            modifiers: ALT,
            down: true,
            repeat: false,
        });
        e.handle(KeyEvent {
            key: "A".into(),
            code: 0,
            modifiers: ALT,
            down: true,
            repeat: true,
        });
        assert_eq!(e.session.mode, Mode::Held);
        assert_eq!(e.session.prefix, "A");
    }
}
