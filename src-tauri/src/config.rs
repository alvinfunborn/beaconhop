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
    pub hold_enabled: bool,
    pub desktop_scope: Scope,
    pub display_scope: Scope,
    pub include_minimized: bool,
    pub include_hidden: bool,
    pub hint_alphabet: String,
    pub thumbnails: bool,
    pub layout: String,
    pub theme: String,
    pub language: String,
    pub start_at_login: bool,
    pub start_in_tray: bool,
    pub excluded_apps: Vec<String>,
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
            hold_enabled: true,
            desktop_scope: Scope::All,
            display_scope: Scope::All,
            include_minimized: true,
            include_hidden: true,
            hint_alphabet: "ASDFGHJKLQWERTYUIOPZXCVBNM".into(),
            thumbnails: true,
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
                    p if p.len() == 1 && p.as_bytes()[0].is_ascii_alphanumeric() => {
                        p.to_ascii_uppercase()
                    }
                    _ => return Err("Use Tab, Space, Backquote, a letter or a digit".into()),
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
    pub fn validate(&self) -> Result<(), String> {
        let hold = Shortcut::parse(&self.hold_shortcut)?;
        let search = Shortcut::parse(&self.search_shortcut)?;
        if hold == search {
            return Err("Choose different shortcuts for hold and search".into());
        }
        if hold.modifiers & SHIFT != 0 {
            return Err("Keep Shift free for reverse cycling in the hold shortcut".into());
        }
        let letters: HashSet<_> = self.hint_alphabet.chars().collect();
        if !(4..=26).contains(&self.hint_alphabet.len())
            || letters.len() != self.hint_alphabet.len()
            || !self.hint_alphabet.bytes().all(|c| c.is_ascii_uppercase())
        {
            return Err("Hint letters must contain 4–26 distinct uppercase A–Z letters".into());
        }
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
    fn shortcuts_are_unambiguous() {
        assert!(Config::default().validate().is_ok());
        for invalid in ["Tab", "Alt+Tab+J", "Alt+Alt+Tab", "Super+"] {
            assert!(Shortcut::parse(invalid).is_err());
        }
        assert_eq!(
            Shortcut::parse("Cmd+`").unwrap(),
            Shortcut::parse("Super+Backquote").unwrap()
        );
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
