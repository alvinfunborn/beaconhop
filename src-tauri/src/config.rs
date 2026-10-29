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
    pub desktop_scope: Scope,
    pub display_scope: Scope,
    pub include_minimized: bool,
    pub include_hidden: bool,
    pub hint_alphabet: String,
    pub hint_charsets: Vec<String>,
    pub hint_extra: String,
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
            hold_shortcut: "Alt+Tab".into(),
            search_shortcut: "Super+Backquote".into(),
            search_entry_key: "Backquote".into(),
            hold_enabled: true,
            desktop_scope: Scope::All,
            display_scope: Scope::All,
            include_minimized: true,
            include_hidden: true,
            hint_alphabet: "ASDFGHJKLQWERTYUIOPZXCVBNM".into(),
            hint_charsets: vec![],
            hint_extra: String::new(),
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
    pub fn hint_contains(&self, character: char) -> bool {
        if self.hint_charsets.is_empty() {
            self.hint_alphabet.contains(character)
        } else {
            self.hint_extra.contains(character)
                || self.hint_charsets.iter().any(|row| row.contains(character))
        }
    }

    pub(crate) fn validate_hint_charsets(&self) -> Result<(), String> {
        if self.hint_charsets.is_empty() {
            validate_charset(&self.hint_alphabet, 2)?;
        } else {
            if self.hint_charsets.len() > 8 {
                return Err("提示最多 8 位 / Use at most 8 hint positions".into());
            }
            for row in &self.hint_charsets {
                validate_charset(row, 1)?;
            }
            validate_charset(&self.hint_extra, 0)?;
            if self
                .hint_extra
                .chars()
                .any(|c| self.hint_charsets[0].contains(c))
            {
                return Err("额外前缀不能与第一位字符重复 / Extra prefixes must differ from the first position".into());
            }
            let capacity = self
                .hint_charsets
                .iter()
                .try_fold(1usize, |n, row| n.checked_mul(row.len()))
                .and_then(|n| n.checked_mul(1 + self.hint_extra.len()));
            if capacity.is_none_or(|n| n > 8192) {
                return Err(
                    "字符组合超过 8192 个，请减少字符或位数 / Limit hint combinations to 8192"
                        .into(),
                );
            }
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), String> {
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
        self.validate_hint_charsets()?;
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
    let config: Config = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    config.validate()?;
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
    fn flexible_charsets_reject_unreachable_or_ambiguous_keys() {
        let mut config = Config::default();
        config.hint_alphabet = "AS12;? ".into();
        config.validate().unwrap();
        config.hint_charsets = vec!["A1; ".into(), "J/?".into()];
        config.hint_extra = "Q\\".into();
        config.validate().unwrap();
        config.hint_extra = "A".into();
        assert!(config.validate().unwrap_err().contains("first position"));
        config.hint_extra = "~".into();
        assert!(config.validate().unwrap_err().contains("conflict"));
        config.search_entry_key = "2".into();
        config.validate().unwrap();
        config.hint_extra = "@".into(); // Shift+2 would otherwise enter search.
        assert!(config.validate().is_err());
        config.hint_extra.clear();
        for invalid in ["AA", "", "é", "\n", "a"] {
            config.hint_charsets[1] = invalid.into();
            assert!(config.validate().is_err());
        }
        config.hint_charsets = vec!["ASDFGHJKL".into(); 8];
        assert!(config.validate().unwrap_err().contains("8192"));
    }

    #[test]
    fn old_settings_get_new_defaults_and_customizations_round_trip() {
        let mut old = serde_json::to_value(Config::default()).unwrap();
        let fields = old.as_object_mut().unwrap();
        for key in [
            "searchEntryKey",
            "hintStyle",
            "panelOpacity",
            "hintCharsets",
            "hintExtra",
        ] {
            fields.remove(key);
        }
        fields.insert("searchShortcut".into(), "Super+Backslash".into());
        let mut restored: Config = serde_json::from_value(old).unwrap();
        assert_eq!(restored.search_entry_key, "Backquote");
        assert_eq!(restored.search_shortcut, "Super+Backslash");
        assert_eq!(restored.hint_style, HintStyle::default());
        assert!(restored.hint_charsets.is_empty());
        assert!(restored.hint_extra.is_empty());
        restored.search_entry_key = "Backslash".into();
        restored.hint_style.opacity = 65;
        restored.hint_style.font_size = 36;
        restored.panel_opacity = 10;
        restored.validate().unwrap();
        let saved: Config =
            serde_json::from_slice(&serde_json::to_vec(&restored).unwrap()).unwrap();
        assert_eq!(saved, restored);
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
