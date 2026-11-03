//! Physical-key aliases used only while a committed hint's last key is held.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Neighbours {
    pub left: Option<String>,
    pub right: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ScreenBuoy {
    pub enabled: bool,
    pub application_path: String,
    pub keys: Vec<String>,
    pub neighbours: BTreeMap<String, Neighbours>,
}

impl Default for ScreenBuoy {
    fn default() -> Self {
        Self {
            enabled: false,
            application_path: String::new(),
            keys: vec!["HintLeftKey".into(), "HintRightKey".into()],
            neighbours: default_neighbours(),
        }
    }
}

pub fn default_neighbours() -> BTreeMap<String, Neighbours> {
    let mut result = BTreeMap::new();
    // Match SB's row-local neighbours, extending them to every printable key.
    // Space has no intrinsic left/right neighbour; users can supply either.
    for row in [
        "`1234567890-=",
        "QWERTYUIOP[]\\",
        "ASDFGHJKL;'",
        "ZXCVBNM,./",
        " ",
    ] {
        let keys: Vec<_> = row
            .chars()
            .map(|c| physical_key(&c.to_string()).unwrap())
            .collect();
        for (i, key) in keys.iter().enumerate() {
            result.insert(
                key.clone(),
                Neighbours {
                    left: i.checked_sub(1).map(|i| keys[i].clone()),
                    right: keys.get(i + 1).cloned(),
                },
            );
        }
    }
    result
}

pub fn physical_key(value: &str) -> Option<String> {
    if value == " " {
        return Some("Space".into());
    }
    let value = value.trim();
    let named = match value.to_ascii_lowercase().as_str() {
        "space" => "Space",
        "tab" => "Tab",
        "enter" | "return" => "Enter",
        "backspace" => "Backspace",
        "backquote" | "`" | "~" => "Backquote",
        "backslash" | "\\" | "|" => "Backslash",
        "arrowleft" | "left" => "ArrowLeft",
        "arrowright" | "right" => "ArrowRight",
        "arrowup" | "up" => "ArrowUp",
        "arrowdown" | "down" => "ArrowDown",
        _ => "",
    };
    if !named.is_empty() {
        return Some(named.into());
    }
    if value.len() != 1 || !value.as_bytes()[0].is_ascii_graphic() {
        return None;
    }
    let c = value.chars().next()?;
    let c = "!@#$%^&*()_+{}:\"<>?"
        .find(c)
        .and_then(|i| "1234567890-=[];',./".chars().nth(i))
        .unwrap_or(c);
    Some(c.to_ascii_uppercase().to_string())
}

pub fn valid_binding(key: &str) -> bool {
    matches!(
        key,
        "Alt" | "Control" | "Super" | "Shift" | "HintLeftKey" | "HintRightKey"
    ) || physical_key(key).as_deref() == Some(key)
}
// Accept the previous single-key fields while always saving key arrays.
pub fn deserialize_bindings<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Bindings {
        One(String),
        Many(Vec<String>),
    }
    Ok(match Bindings::deserialize(deserializer)? {
        Bindings::One(key) => vec![key],
        Bindings::Many(keys) => keys,
    })
}
pub fn binding_key(
    binding: &str,
    last: &str,
    neighbours: &BTreeMap<String, Neighbours>,
) -> Option<String> {
    match binding {
        "HintLeftKey" => neighbours.get(last)?.left.clone(),
        "HintRightKey" => neighbours.get(last)?.right.clone(),
        "Alt" | "Control" | "Super" | "Shift" => Some(binding.into()),
        other => physical_key(other),
    }
}

impl ScreenBuoy {
    pub fn matches(&self, last: &str, key: &str) -> bool {
        if !self.enabled || last == key {
            return false;
        }
        let neighbours = self.neighbours.get(last);
        self.keys.iter().any(|binding| match binding.as_str() {
            "HintLeftKey" => neighbours.and_then(|n| n.left.as_deref()) == Some(key),
            "HintRightKey" => neighbours.and_then(|n| n.right.as_deref()) == Some(key),
            other => physical_key(other).as_deref() == Some(key),
        })
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.application_path.len() > 4096 || self.application_path.contains('\0') {
            return Err("Invalid Screen Buoy application path / SB 应用路径无效".into());
        }
        let mut unique = HashSet::new();
        for key in &self.keys {
            let key = match key.as_str() {
                "HintLeftKey" | "HintRightKey" => key.clone(),
                _ => physical_key(key).ok_or(
                    "Use HintLeftKey, HintRightKey or a physical key / 请使用左右邻键或单个物理键",
                )?,
            };
            if !unique.insert(key) {
                return Err("Duplicate SB activation key / SB 触发键重复".into());
            }
        }
        if self.enabled && unique.is_empty() {
            return Err("Choose an SB activation key / 请选择 SB 触发键".into());
        }
        for (key, sides) in &self.neighbours {
            if physical_key(key).as_deref() != Some(key) {
                return Err("Invalid neighbour map key / 左右键映射键名无效".into());
            }
            for side in [&sides.left, &sides.right].into_iter().flatten() {
                if physical_key(side).as_deref() != Some(side) || side == key {
                    return Err(
                        "A neighbour must be a different physical key / 邻键须为另一个物理键"
                            .into(),
                    );
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_printable_hint_resolves_to_a_physical_key() {
        for c in 32u8..=126 {
            assert!(physical_key(&(c as char).to_string()).is_some());
        }
        for (symbol, key) in [
            ("?", "/"),
            ("!", "1"),
            ("|", "Backslash"),
            ("~", "Backquote"),
            (" ", "Space"),
            ("+", "="),
        ] {
            assert_eq!(physical_key(symbol).as_deref(), Some(key));
        }
    }
    #[test]
    fn dynamic_and_explicit_keys_coexist_without_reserving_hint_characters() {
        let mut settings = ScreenBuoy {
            enabled: true,
            keys: vec!["HintLeftKey".into(), "HintRightKey".into(), "Enter".into()],
            ..Default::default()
        };
        assert!(settings.matches("J", "H"));
        assert!(settings.matches("J", "K"));
        assert!(settings.matches("/", "."));
        assert!(settings.matches("Space", "Enter"));
        assert!(!settings.matches("J", "J"));
        settings.neighbours.get_mut("Space").unwrap().right = Some("ArrowRight".into());
        assert!(settings.matches("Space", "ArrowRight"));
        settings.validate().unwrap();
        settings.keys.push("return".into());
        assert!(settings.validate().is_err());
    }
}
