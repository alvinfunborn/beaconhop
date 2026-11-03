use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::Path};

pub const ALT: u8 = 1;
pub const CTRL: u8 = 2;
pub const SUPER: u8 = 4;
pub const SHIFT: u8 = 8;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub hold_shortcut: String,
    pub search_shortcut: String,
    pub search_entry_key: String,
    pub hold_enabled: bool,
    pub application_enabled: bool,
    pub application_hold_shortcut: String,
    pub application_search_shortcut: String,
    pub tabs_enabled: bool,
    pub tabs_hold_shortcut: String,
    pub tabs_search_shortcut: String,
    #[serde(
        alias = "applicationHintKey",
        deserialize_with = "crate::hint_keys::deserialize_bindings"
    )]
    pub application_hint_keys: Vec<String>,
    #[serde(
        alias = "tabsHintKey",
        deserialize_with = "crate::hint_keys::deserialize_bindings"
    )]
    pub tabs_hint_keys: Vec<String>,
    pub desktops_enabled: bool,
    pub desktops_hold_shortcut: String,
    pub desktops_search_shortcut: String,
    #[serde(
        alias = "windowsHintKey",
        deserialize_with = "crate::hint_keys::deserialize_bindings"
    )]
    pub windows_hint_keys: Vec<String>,
    pub codex_home: String,
    pub desktop_scope: Scope,
    pub display_scope: Scope,
    pub include_minimized: bool,
    pub include_hidden: bool,
    pub hint_alphabet: String,
    pub screen_buoy: crate::hint_keys::ScreenBuoy,
    pub thumbnails: bool,
    pub panel_opacity: u8,
    pub hint_style: HintStyle,
    pub layout: String,
    pub theme: String,
    pub language: String,
    pub start_at_login: bool,
    pub start_in_tray: bool,
    pub excluded_apps: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct HintStyle {
    pub font_size: u8,
    pub font_weight: u16,
    pub color: String,
    pub background: String,
    pub opacity: u8,
    pub radius: u8,
    pub border_color: String,
    pub border_width: u8,
    pub shadow: bool,
}
impl Default for HintStyle {
    fn default() -> Self {
        Self {
            font_size: 28,
            font_weight: 700,
            color: "#19130a".into(),
            background: "#ffcf48".into(),
            opacity: 100,
            radius: 8,
            border_color: "#30220c".into(),
            border_width: 2,
            shadow: true,
        }
    }
}
impl HintStyle {
    fn validate(&self) -> Result<(), String> {
        let color = |s: &str| {
            s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
        };
        if !(12..=48).contains(&self.font_size)
            || ![500, 600, 700, 800].contains(&self.font_weight)
            || self.opacity > 100
            || self.radius > 24
            || self.border_width > 6
            || ![&self.color, &self.background, &self.border_color]
                .iter()
                .all(|s| color(s))
        {
            return Err("Invalid hint style: check size, colors, opacity and borders".into());
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Current,
    #[default]
    All,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hold_shortcut: "Super+Tab".into(),
            search_shortcut: "Super+Backquote".into(),
            search_entry_key: "Backquote".into(),
            hold_enabled: true,
            application_enabled: true,
            application_hold_shortcut: "Alt+Tab".into(),
            application_search_shortcut: "Alt+Backquote".into(),
            tabs_enabled: true,
            tabs_hold_shortcut: "Ctrl+Tab".into(),
            tabs_search_shortcut: "Ctrl+Backquote".into(),
            application_hint_keys: vec!["Alt".into()],
            tabs_hint_keys: vec!["Control".into()],
            desktops_enabled: true,
            desktops_hold_shortcut: "Ctrl+Super+Tab".into(),
            desktops_search_shortcut: "Ctrl+Super+Backquote".into(),
            windows_hint_keys: vec!["Super".into()],
            codex_home: String::new(),
            desktop_scope: Scope::All,
            display_scope: Scope::All,
            include_minimized: true,
            include_hidden: true,
            hint_alphabet: "ASDFGHJKLQWERTYUIOPZXCVBNM".into(),
            screen_buoy: Default::default(),
            thumbnails: true,
            panel_opacity: 24,
            hint_style: HintStyle::default(),
            layout: "grid".into(),
            theme: "system".into(),
            language: "system".into(),
            start_at_login: false,
            start_in_tray: false,
            excluded_apps: vec![],
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Shortcut {
    pub modifiers: u8,
    pub key: String,
}
pub fn parse_search_entry_key(value: &str) -> Result<String, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "backquote" | "`" => Ok("Backquote".into()),
        "backslash" | "\\" => Ok("Backslash".into()),
        "space" => Ok("Space".into()),
        key if key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric() => {
            Ok(key.to_ascii_uppercase())
        }
        _ => Err("Use Backquote, Backslash, Space, a letter or a digit without modifiers".into()),
    }
}
impl Shortcut {
    pub fn parse(value: &str) -> Result<Self, String> {
        let mut modifiers = 0;
        let mut key = None;
        for part in value.split('+') {
            let part = part.trim();
            let flag = match part.to_ascii_lowercase().as_str() {
                "alt" | "option" => ALT,
                "ctrl" | "control" => CTRL,
                "super" | "cmd" | "command" | "win" | "meta" => SUPER,
                "shift" => SHIFT,
                _ => 0,
            };
            if flag != 0 {
                if modifiers & flag != 0 {
                    return Err("Duplicate shortcut modifier".into());
                }
                modifiers |= flag;
            } else if key.is_some() {
                return Err("A shortcut needs exactly one non-modifier key".into());
            } else {
                key = Some(match part.to_ascii_lowercase().as_str() {
                    "tab" => "Tab".into(),
                    "space" => "Space".into(),
                    "backquote" | "`" => "Backquote".into(),
                    "backslash" | "\\" => "Backslash".into(),
                    p if p.len() == 1 && p.as_bytes()[0].is_ascii_alphanumeric() => {
                        p.to_ascii_uppercase()
                    }
                    _ => {
                        return Err(
                            "Use Tab, Space, Backquote, Backslash, a letter or a digit".into()
                        )
                    }
                });
            }
        }
        if modifiers & (ALT | CTRL | SUPER) == 0 {
            return Err("Include Alt, Control or Command / Windows".into());
        }
        Ok(Self {
            modifiers,
            key: key.ok_or("Shortcut key is missing")?,
        })
    }
    pub fn matches(&self, key: &str, modifiers: u8, reverse: bool) -> bool {
        key == self.key
            && (if reverse {
                modifiers & !SHIFT
            } else {
                modifiers
            }) == self.modifiers
    }
}

impl Config {
    fn validate_layers(&self) -> Result<(), String> {
        let mut shortcuts = Vec::new();
        for (hold_enabled, search_enabled, hold, search) in [
            (
                self.hold_enabled,
                true,
                &self.hold_shortcut,
                &self.search_shortcut,
            ),
            (
                self.application_enabled,
                self.application_enabled,
                &self.application_hold_shortcut,
                &self.application_search_shortcut,
            ),
            (
                self.tabs_enabled,
                self.tabs_enabled,
                &self.tabs_hold_shortcut,
                &self.tabs_search_shortcut,
            ),
            (
                self.desktops_enabled,
                self.desktops_enabled,
                &self.desktops_hold_shortcut,
                &self.desktops_search_shortcut,
            ),
        ] {
            let h = Shortcut::parse(hold)?;
            let s = Shortcut::parse(search)?;
            if h.modifiers & SHIFT != 0 {
                return Err("Keep Shift free for reverse cycling".into());
            }
            for (enabled, shortcut) in [(hold_enabled, &h), (search_enabled, &s)] {
                if enabled {
                    if shortcuts.iter().any(|(key, mods)| {
                        key == &shortcut.key && *mods == shortcut.modifiers & !SHIFT
                    }) {
                        return Err(
                            "Each navigation layer needs a different shortcut / 各层快捷键不能重复"
                                .into(),
                        );
                    }
                    shortcuts.push((shortcut.key.clone(), shortcut.modifiers & !SHIFT));
                }
            }
            if h.key == parse_search_entry_key(&self.search_entry_key)?
                || [0, SHIFT]
                    .iter()
                    .any(|m| hint_character(&h.key, *m).is_some_and(|c| self.hint_contains(c)))
            {
                return Err("Cycling, search and hint keys must not conflict".into());
            }
        }
        self.validate_continuations()?;
        if self.codex_home.len() > 4096
            || self.codex_home.contains('\0')
            || (!self.codex_home.is_empty() && !Path::new(&self.codex_home).is_absolute())
        {
            return Err(
                "Use an absolute Codex data folder path / Codex 数据目录需要绝对路径".into(),
            );
        }
        Ok(())
    }
    fn validate_continuations(&self) -> Result<(), String> {
        let groups = [
            (self.hold_enabled, &self.windows_hint_keys),
            (self.application_enabled, &self.application_hint_keys),
            (self.tabs_enabled, &self.tabs_hint_keys),
        ];
        for (_, keys) in groups {
            if keys.len() > 64 || keys.iter().any(|key| !crate::hint_keys::valid_binding(key)) {
                return Err("Invalid continuation key / 后续触发键无效".into());
            }
            if keys.iter().collect::<HashSet<_>>().len() != keys.len() {
                return Err("Duplicate continuation key / 后续触发键重复".into());
            }
        }
        let mut last_keys: Vec<_> = self.screen_buoy.neighbours.keys().cloned().collect();
        last_keys.push("A".into());
        for last in last_keys {
            let mut occupied = HashSet::new();
            for (enabled, keys) in groups
                .into_iter()
                .chain([(self.screen_buoy.enabled, &self.screen_buoy.keys)])
            {
                if !enabled {
                    continue;
                }
                // Aliases and fixed keys may overlap within one action. Only different
                // actions competing for the same physical key are ambiguous.
                let resolved: HashSet<_> = keys
                    .iter()
                    .filter_map(|binding| {
                        crate::hint_keys::binding_key(binding, &last, &self.screen_buoy.neighbours)
                    })
                    .filter(|key| key != &last)
                    .collect();
                if resolved.into_iter().any(|key| !occupied.insert(key)) {
                    return Err(
                        "Continuation keys conflict / 后续触发键不能重复用于不同动作".into(),
                    );
                }
            }
        }
        Ok(())
    }
    pub fn hint_contains(&self, character: char) -> bool {
        self.hint_alphabet.contains(character)
    }

    pub fn validate(&self) -> Result<(), String> {
        self.screen_buoy.validate()?;
        self.validate_layers()?;
        self.hint_style.validate()?;
        if self.panel_opacity > 100 {
            return Err("Panel opacity must be 0–100".into());
        }
        let hold = Shortcut::parse(&self.hold_shortcut)?;
        let search = Shortcut::parse(&self.search_shortcut)?;
        if hold == search {
            return Err("Choose different shortcuts for hold and search".into());
        }
        if hold.modifiers & SHIFT != 0 {
            return Err("Keep Shift free for reverse cycling in the hold shortcut".into());
        }
        let entry = parse_search_entry_key(&self.search_entry_key)?;
        if entry == hold.key
            || [0, SHIFT]
                .iter()
                .any(|shift| hint_character(&entry, *shift).is_some_and(|c| self.hint_contains(c)))
            || [0, SHIFT].iter().any(|shift| {
                hint_character(&hold.key, *shift).is_some_and(|c| self.hint_contains(c))
            })
        {
            return Err(
                "搜索键、循环键与提示字符不能冲突 / Search, cycling and hint keys must not conflict".into(),
            );
        }
        validate_charset(&self.hint_alphabet, 2)?;
        if !["grid", "list"].contains(&self.layout.as_str()) {
            return Err("Unknown layout".into());
        }
        if !["system", "dark", "light"].contains(&self.theme.as_str()) {
            return Err("Unknown theme".into());
        }
        if !["system", "en", "zh"].contains(&self.language.as_str()) {
            return Err("Unknown language".into());
        }
        if self.excluded_apps.len() > 100 || self.excluded_apps.iter().any(|s| s.len() > 200) {
            return Err("Too many or too long application exclusions".into());
        }
        Ok(())
    }
}

pub(crate) fn validate_charset(value: &str, min: usize) -> Result<(), String> {
    let unique: HashSet<_> = value.chars().collect();
    if value.len() < min
        || unique.len() != value.len()
        || !value
            .bytes()
            .all(|c| (c.is_ascii_graphic() || c == b' ') && !c.is_ascii_lowercase())
    {
        return Err(format!("至少 {min} 个不重复字符：英文字母、数字、标点或空格 / Use {min}+ unique uppercase letters, digits, punctuation or spaces"));
    }
    Ok(())
}

// Use the same physical key names on both platforms, independently of the IME.
// Shift changes digits/punctuation; letters are always displayed in uppercase.
pub(crate) fn hint_character(key: &str, modifiers: u8) -> Option<char> {
    let character = match key {
        "Backquote" => '`',
        "Backslash" => '\\',
        "Space" => ' ',
        key if key.len() == 1 => key.chars().next()?,
        _ => return None,
    };
    if modifiers & SHIFT != 0 {
        if let Some(index) = "`1234567890-=[]\\;',./".find(character) {
            return "~!@#$%^&*()_+{}|:\"<>?".chars().nth(index);
        }
    }
    Some(character)
}

pub fn load(path: &Path) -> Result<Config, String> {
    if !path.exists() {
        return Ok(Config::default());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let config = migrate(value)?;
    config.validate()?;
    Ok(config)
}
fn migrate(value: serde_json::Value) -> Result<Config, String> {
    let legacy = value.get("applicationHoldShortcut").is_none();
    let legacy_bindings = ["windowsHintKeys", "applicationHintKeys", "tabsHintKeys"]
        .iter()
        .all(|key| value.get(*key).is_none());
    let mut config: Config = serde_json::from_value(value).map_err(|e| e.to_string())?;
    if legacy {
        // The old macOS default occupied Alt. Free it for the application layer.
        if config.hold_shortcut == "Alt+Tab" {
            config.hold_shortcut = "Super+Tab".into();
        }
        // Preserve custom shortcuts; newly introduced layers can be enabled after resolving conflicts.
        let collides = |hold: &str, search: &str| {
            [&config.hold_shortcut, &config.search_shortcut]
                .iter()
                .any(|old| {
                    let old = Shortcut::parse(old).ok();
                    [hold, search].iter().any(|new| {
                        old.as_ref()
                            .zip(Shortcut::parse(new).ok().as_ref())
                            .is_some_and(|(old, new)| {
                                old.key == new.key
                                    && old.modifiers & !SHIFT == new.modifiers & !SHIFT
                            })
                    })
                })
        };
        config.application_enabled = !collides(
            &config.application_hold_shortcut,
            &config.application_search_shortcut,
        );
        config.tabs_enabled = !collides(&config.tabs_hold_shortcut, &config.tabs_search_shortcut);
        config.desktops_enabled = !collides(
            &config.desktops_hold_shortcut,
            &config.desktops_search_shortcut,
        );
    }
    if legacy_bindings && config.screen_buoy.keys == ["HintRightKey"] {
        // Upgrade the former default once. Keep custom keys and avoid taking a key
        // already assigned to another continuation, even while SB is disabled.
        let mut upgraded = config.clone();
        upgraded.screen_buoy.keys = crate::hint_keys::ScreenBuoy::default().keys;
        upgraded.screen_buoy.enabled = true;
        if upgraded.validate_continuations().is_ok() {
            config.screen_buoy.keys = upgraded.screen_buoy.keys;
        }
    }
    Ok(config)
}
pub fn save(path: &Path, config: &Config) -> Result<(), String> {
    config.validate()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    use std::io::Write;
    let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_defaults_migrate_legacy_alt_without_losing_other_settings() {
        let old = serde_json::json!({"holdShortcut":"Alt+Tab","panelOpacity":42,"language":"zh","screenBuoy":{"enabled":true,"keys":["HintRightKey"]}});
        let config = migrate(old).unwrap();
        config.validate().unwrap();
        assert_eq!(config.hold_shortcut, "Super+Tab");
        assert_eq!(config.application_hold_shortcut, "Alt+Tab");
        assert_eq!(config.panel_opacity, 42);
        assert!(config.screen_buoy.enabled);
        let custom = migrate(serde_json::json!({"holdShortcut":"Ctrl+Tab"})).unwrap();
        custom.validate().unwrap();
        assert_eq!(custom.hold_shortcut, "Ctrl+Tab");
        assert!(!custom.tabs_enabled);
        let reverse = migrate(serde_json::json!({"searchShortcut":"Ctrl+Shift+Tab"})).unwrap();
        reverse.validate().unwrap();
        assert!(!reverse.tabs_enabled);
    }
    #[test]
    fn layer_and_continuation_conflicts_are_rejected_before_saving() {
        let mut config = Config::default();
        config.validate().unwrap();
        config.hold_enabled = false;
        config.search_shortcut = "Alt+Tab".into();
        assert!(config.validate().is_err()); // Window search is always enabled.
        config = Config::default();
        config.tabs_hint_keys = vec!["Alt".into()];
        assert!(config.validate().is_err());
        config.tabs_hint_keys = vec!["HintRightKey".into()];
        config.screen_buoy.enabled = true;
        assert!(config.validate().is_err());
        config.tabs_hint_keys = vec!["Control".into()];
        config.windows_hint_keys = vec!["Control".into()];
        assert!(config.validate().is_err());
        config.windows_hint_keys = vec!["Super".into()];
        config.tabs_hold_shortcut = "Alt+Tab".into();
        assert!(config.validate().is_err());
        config.tabs_hold_shortcut = "Ctrl+Tab".into();
        config.validate().unwrap();
    }
    #[test]
    fn continuation_binding_migration_preserves_custom_settings_and_saves_arrays() {
        let old = serde_json::json!({
            "applicationHoldShortcut":"Alt+Tab", "windowsHintKey":"Super",
            "applicationHintKey":"Alt", "tabsHintKey":"Enter",
            "screenBuoy":{"enabled":true,"keys":["HintRightKey"]}
        });
        let config = migrate(old.clone()).unwrap();
        config.validate().unwrap();
        assert_eq!(config.tabs_hint_keys, ["Enter"]);
        assert_eq!(config.screen_buoy.keys, ["HintLeftKey", "HintRightKey"]);
        let saved = serde_json::to_value(&config).unwrap();
        assert_eq!(saved["tabsHintKeys"], serde_json::json!(["Enter"]));
        for key in ["windowsHintKey", "applicationHintKey", "tabsHintKey"] {
            assert!(saved.get(key).is_none());
        }
        let mut restored = migrate(saved).unwrap();
        restored.screen_buoy.keys = vec!["HintRightKey".into()];
        let restored = migrate(serde_json::to_value(restored).unwrap()).unwrap();
        assert_eq!(restored.screen_buoy.keys, ["HintRightKey"]);
        for keys in [vec!["Enter"], vec!["HintLeftKey", "Enter"], vec![]] {
            let mut custom = old.clone();
            custom["screenBuoy"] = serde_json::json!({"enabled":false,"keys":keys});
            assert_eq!(migrate(custom).unwrap().screen_buoy.keys, keys);
        }
        let mut conflict = old;
        conflict["tabsHintKey"] = "HintLeftKey".into();
        let config = migrate(conflict).unwrap();
        config.validate().unwrap();
        assert_eq!(config.tabs_hint_keys, ["HintLeftKey"]);
        assert_eq!(config.screen_buoy.keys, ["HintRightKey"]);
    }
    #[test]
    fn multiple_continuation_keys_share_one_action_but_not_competing_actions() {
        let mut config = Config::default();
        config.tabs_hint_keys = vec!["Control".into(), "Enter".into()];
        config.screen_buoy.enabled = true;
        config.screen_buoy.keys.push("H".into()); // Also J's left neighbour.
        config.validate().unwrap();
        let restored = migrate(serde_json::to_value(&config).unwrap()).unwrap();
        assert_eq!(restored.tabs_hint_keys, ["Control", "Enter"]);
        config.windows_hint_keys.push("Enter".into());
        assert!(config.validate().unwrap_err().contains("conflict"));
        config.windows_hint_keys.pop();
        config.tabs_hint_keys.push("Control".into());
        assert!(config.validate().unwrap_err().contains("Duplicate"));
        config.tabs_hint_keys = vec!["H".into()];
        config.screen_buoy.keys.pop();
        assert!(config.validate().unwrap_err().contains("conflict"));
        config.tabs_hint_keys.clear();
        config.validate().unwrap(); // Disable continuation without disabling Ctrl+Tab.
        assert!(config.tabs_enabled);
    }
    #[test]
    fn flexible_characters_reject_unreachable_or_ambiguous_keys() {
        let mut config = Config::default();
        config.hint_alphabet = "AS12;? ".into();
        config.validate().unwrap();
        config.hint_alphabet.push('~');
        assert!(config.validate().unwrap_err().contains("conflict"));
        config.search_entry_key = "9".into();
        config.validate().unwrap();
        config.hint_alphabet.push('('); // Shift+9 would otherwise enter search.
        assert!(config.validate().unwrap_err().contains("conflict"));
        for invalid in ["AA", "", "A", "é", "AS\n", "as"] {
            config.hint_alphabet = invalid.into();
            assert!(config.validate().is_err());
        }
    }

    #[test]
    fn old_settings_get_new_defaults_and_customizations_round_trip() {
        let mut old = serde_json::to_value(Config::default()).unwrap();
        let fields = old.as_object_mut().unwrap();
        for key in ["searchEntryKey", "hintStyle", "panelOpacity", "screenBuoy"] {
            fields.remove(key);
        }
        fields.insert("searchShortcut".into(), "Super+Backslash".into());
        fields.insert("hintAlphabet".into(), "AS12;? ".into());
        fields.insert("hintCharsets".into(), serde_json::json!(["AS", "JK"]));
        fields.insert("hintExtra".into(), "Q".into());
        let mut restored: Config = serde_json::from_value(old).unwrap();
        assert_eq!(restored.hint_alphabet, "AS12;? ");
        assert_eq!(restored.search_entry_key, "Backquote");
        assert_eq!(restored.search_shortcut, "Super+Backslash");
        assert_eq!(restored.hint_style, HintStyle::default());
        assert!(!restored.screen_buoy.enabled);
        restored.screen_buoy.enabled = true;
        restored.screen_buoy.keys = vec!["HintLeftKey".into(), "Enter".into()];
        restored
            .screen_buoy
            .neighbours
            .get_mut("Space")
            .unwrap()
            .right = Some("ArrowRight".into());
        restored.search_entry_key = "Backslash".into();
        restored.hint_style.opacity = 65;
        restored.hint_style.font_size = 36;
        restored.panel_opacity = 10;
        restored.validate().unwrap();
        let saved: Config =
            serde_json::from_slice(&serde_json::to_vec(&restored).unwrap()).unwrap();
        assert_eq!(saved, restored);
        let serialized = serde_json::to_value(saved).unwrap();
        assert!(serialized.get("hintCharsets").is_none());
        assert!(serialized.get("hintExtra").is_none());
    }
    #[test]
    fn search_key_conflicts_and_invalid_styles_are_rejected() {
        let mut config = Config::default();
        for key in ["A", "Tab", "Alt+Backquote", "Escape", "ArrowUp"] {
            config.search_entry_key = key.into();
            assert!(config.validate().is_err());
        }
        config.search_entry_key = "1".into();
        config.validate().unwrap();
        config.hold_shortcut = "Alt+1".into();
        assert!(config.validate().is_err());
        config.hold_shortcut = "Alt+Tab".into();
        config.hint_style.background = "url(https://example.com)".into();
        assert!(config.validate().is_err());
        config.hint_style = HintStyle::default();
        config.hint_style.opacity = 101;
        assert!(config.validate().is_err());
        config.hint_style.opacity = 50;
        config.panel_opacity = 101;
        assert!(config.validate().is_err());
    }
    #[test]
    fn shortcuts_are_unambiguous() {
        assert!(Config::default().validate().is_ok());
        for invalid in ["Tab", "Alt+Tab+J", "Alt+Alt+Tab", "Super+"] {
            assert!(Shortcut::parse(invalid).is_err());
        }
        assert_eq!(
            Shortcut::parse("Cmd+`").unwrap(),
            Shortcut::parse("Super+Backquote").unwrap()
        );
        assert_eq!(
            Shortcut::parse("Win+\\").unwrap(),
            Shortcut::parse("Super+Backslash").unwrap()
        );
        let mut config = Config::default();
        config.search_shortcut = "Super+Backslash".into();
        assert!(config.validate().is_ok());
    }
    #[test]
    fn invalid_settings_never_reach_disk() {
        let mut c = Config::default();
        c.hint_alphabet = "AAAA".into();
        assert!(c.validate().is_err());
        c.hint_alphabet = "ASDF".into();
        c.search_shortcut = c.hold_shortcut.clone();
        assert!(c.validate().is_err());
    }
}
