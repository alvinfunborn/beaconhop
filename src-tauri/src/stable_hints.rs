use crate::config::Config;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

// Reserve two branches at each depth. Existing short codes never become prefixes
// when new windows arrive (e.g. A stays A; expansion happens under N and M).
fn pool(alphabet: &str, count: usize) -> Vec<String> {
    let chars: Vec<_> = alphabet.chars().collect();
    if chars.len() < 2 {
        return vec![];
    }
    let split = chars.len() - if chars.len() >= 4 { 2 } else { 1 };
    let mut branches = VecDeque::from([String::new()]);
    let mut result = Vec::new();
    while result.len() < count {
        let prefix = branches.pop_front().unwrap();
        for c in &chars[..split] {
            result.push(format!("{prefix}{c}"));
            if result.len() == count {
                return result;
            }
        }
        for c in &chars[split..] {
            branches.push_back(format!("{prefix}{c}"));
        }
    }
    result
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct StableHints {
    alphabet: String,
    #[serde(default)]
    charsets: Vec<String>,
    #[serde(default)]
    extra: String,
    codes: Vec<String>,
    assignments: HashMap<String, String>,
    #[serde(skip)]
    pub dirty: bool,
}
impl StableHints {
    fn pool(&self, count: usize) -> Vec<String> {
        if self.charsets.is_empty() {
            pool(&self.alphabet, count)
        } else {
            let rows = self
                .charsets
                .iter()
                .map(|row| row.chars().collect())
                .collect::<Vec<_>>();
            let mut codes = crate::codes::generate(&rows, &self.extra.chars().collect::<Vec<_>>());
            codes.truncate(count);
            codes
        }
    }

    pub fn load(path: &std::path::Path) -> Self {
        let valid = || -> Option<Self> {
            if std::fs::metadata(path).ok()?.len() > 1024 * 1024 {
                return None;
            }
            let state: Self = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
            let config = Config {
                hint_alphabet: state.alphabet.clone(),
                hint_charsets: state.charsets.clone(),
                hint_extra: state.extra.clone(),
                ..Config::default()
            };
            if config.validate_hint_charsets().is_err()
                || state.codes.len() > 8192
                || state.codes != state.pool(state.codes.len())
            {
                return None;
            }
            let unique: HashSet<_> = state.assignments.values().collect();
            if unique.len() != state.assignments.len()
                || unique.iter().any(|v| !state.codes.contains(v))
            {
                return None;
            }
            Some(state)
        };
        valid().unwrap_or_default()
    }
    pub fn sync(&mut self, config: &Config, ids: &[String]) {
        if self.alphabet != config.hint_alphabet
            || self.charsets != config.hint_charsets
            || self.extra != config.hint_extra
        {
            *self = Self {
                alphabet: config.hint_alphabet.clone(),
                charsets: config.hint_charsets.clone(),
                extra: config.hint_extra.clone(),
                dirty: true,
                ..Self::default()
            };
        }
        // Empty/temporarily unauthorized inventories must not erase learned codes.
        if ids.is_empty() {
            return;
        }
        let live: HashSet<_> = ids.iter().collect();
        let before = self.assignments.len();
        self.assignments.retain(|id, _| live.contains(id));
        self.dirty |= before != self.assignments.len();
        if self.codes.len() < ids.len() {
            self.codes = self.pool(ids.len());
            self.dirty = true;
        }
        let mut sorted = ids.to_vec();
        sorted.sort();
        let mut used: HashSet<_> = self.assignments.values().cloned().collect();
        for id in sorted {
            if self.assignments.contains_key(&id) {
                continue;
            }
            let free: Vec<_> = self
                .codes
                .iter()
                .filter(|code| !used.contains(*code))
                .collect();
            let Some(shortest) = free.iter().map(|s| s.len()).min() else {
                break;
            };
            let free: Vec<_> = free.into_iter().filter(|s| s.len() == shortest).collect();
            let hash = id.bytes().fold(0xcbf29ce484222325u64, |h, c| {
                (h ^ u64::from(c)).wrapping_mul(0x100000001b3)
            });
            let code = free[(hash % free.len() as u64) as usize].clone();
            used.insert(code.clone());
            self.assignments.insert(id, code);
            self.dirty = true;
        }
    }
    pub fn get(&self, id: &str) -> String {
        self.assignments.get(id).cloned().unwrap_or_default()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_positions_expand_after_short_codes_without_reassigning_or_panicking_on_capacity() {
        let mut config = Config::default();
        config.hint_charsets = vec!["A;".into(), "1 ".into()];
        config.hint_extra = "Q/".into();
        let mut hints = StableHints::default();
        let ids: Vec<_> = (0..4).map(|i| i.to_string()).collect();
        hints.sync(&config, &ids);
        assert!(hints.codes.iter().all(|code| code.len() == 2));
        let before = hints.assignments.clone();
        let more: Vec<_> = (0..20).map(|i| i.to_string()).collect();
        hints.sync(&config, &more);
        assert_eq!(hints.assignments.len(), 12);
        assert!(more.iter().any(|id| hints.get(id).is_empty()));
        for (id, code) in before {
            assert_eq!(hints.get(&id), code);
        }
        for a in &hints.codes {
            for b in &hints.codes {
                if a != b {
                    assert!(!a.starts_with(b));
                }
            }
        }
        let path = std::env::temp_dir().join(format!(
            "beaconhop-hints-{}-custom.json",
            std::process::id()
        ));
        std::fs::write(&path, serde_json::to_vec(&hints).unwrap()).unwrap();
        assert_eq!(StableHints::load(&path).assignments, hints.assignments);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn existing_saved_alphabet_assignments_survive_schema_migration() {
        let config = Config::default();
        let mut hints = StableHints::default();
        hints.sync(&config, &["existing-window".into()]);
        let mut old = serde_json::to_value(&hints).unwrap();
        old.as_object_mut().unwrap().remove("charsets");
        old.as_object_mut().unwrap().remove("extra");
        let path = std::env::temp_dir().join(format!(
            "beaconhop-hints-{}-legacy.json",
            std::process::id()
        ));
        std::fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
        let mut restored = StableHints::load(&path);
        restored.sync(&config, &["existing-window".into(), "new-window".into()]);
        assert_eq!(
            restored.get("existing-window"),
            hints.get("existing-window")
        );
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn stable_codes_survive_growth_reorder_rename_scope_and_restart() {
        let mut config = Config::default();
        let mut hints = StableHints::default();
        let ids: Vec<_> = (0..10).map(|i| format!("mac:1:{i}")).collect();
        hints.sync(&config, &ids);
        let before = hints.assignments.clone();
        let mut more: Vec<_> = (0..150).map(|i| format!("mac:1:{i}")).collect();
        more.reverse();
        hints.sync(&config, &more);
        for (id, code) in before {
            assert_eq!(hints.get(&id), code);
        }
        let codes: Vec<_> = hints.assignments.values().collect();
        for (i, a) in codes.iter().enumerate() {
            for (j, b) in codes.iter().enumerate() {
                if i != j {
                    assert!(!a.starts_with(b.as_str()));
                }
            }
        }
        let restored: StableHints =
            serde_json::from_str(&serde_json::to_string(&hints).unwrap()).unwrap();
        assert_eq!(restored.assignments, hints.assignments);
        hints.sync(&config, &[]);
        assert_eq!(hints.assignments.len(), 150);
        config.hint_alphabet = "ASDF".into();
        hints.sync(&config, &more);
        assert!(hints
            .assignments
            .values()
            .all(|c| c.chars().all(|c| "ASDF".contains(c))));
    }
}
