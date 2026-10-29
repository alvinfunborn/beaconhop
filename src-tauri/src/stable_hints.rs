use crate::config::Config;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

// Use single keys first. Only when they run out, replace the least-preferred
// single with its two-key combinations. Expand from the end so earlier keys
// stay short; keep existing two-key branches first so they retain their codes.
fn pool(alphabet: &str, count: usize) -> Vec<String> {
    let chars: Vec<_> = alphabet.chars().collect();
    if chars.len() < 2 {
        return vec![];
    }
    let count = count.min(chars.len() * chars.len());
    let expanded = count.saturating_sub(chars.len()).div_ceil(chars.len() - 1);
    let split = chars.len() - expanded;
    let mut result: Vec<_> = chars[..split].iter().map(char::to_string).collect();
    for prefix in chars[split..].iter().rev() {
        for suffix in &chars {
            result.push(format!("{prefix}{suffix}"));
        }
    }
    result.truncate(count);
    result
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct StableHints {
    alphabet: String,
    codes: Vec<String>,
    assignments: HashMap<String, String>,
    #[serde(skip)]
    pub dirty: bool,
}
impl StableHints {
    pub fn load(path: &std::path::Path) -> Self {
        let valid = || -> Option<Self> {
            if std::fs::metadata(path).ok()?.len() > 1024 * 1024 {
                return None;
            }
            let mut state: Self = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
            if crate::config::validate_charset(&state.alphabet, 2).is_err()
                || state.codes.len() > 8192
            {
                return None;
            }
            let unique: HashSet<_> = state.assignments.values().collect();
            if unique.len() != state.assignments.len()
                || unique.iter().any(|v| !state.codes.contains(v))
            {
                return None;
            }
            // Migrate old unbounded/per-position caches without discarding
            // assignments that are still valid in the short-hint pool.
            state.resize_pool(state.codes.len());
            Some(state)
        };
        valid().unwrap_or_default()
    }

    fn resize_pool(&mut self, count: usize) {
        let codes = pool(&self.alphabet, count);
        if self.codes != codes {
            self.codes = codes;
            let allowed: HashSet<_> = self.codes.iter().collect();
            self.assignments.retain(|_, code| allowed.contains(code));
            self.dirty = true;
        }
    }

    pub fn sync(&mut self, config: &Config, ids: &[String]) {
        if self.alphabet != config.hint_alphabet {
            *self = Self {
                alphabet: config.hint_alphabet.clone(),
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
        // Retain the high-water pool when windows close to avoid renaming
        // familiar hints. New assignments always take an available single first.
        if self.codes.len() < live.len() && self.codes.len() < self.alphabet.len().pow(2) {
            self.resize_pool(live.len());
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
    fn check_codes(codes: &[String]) {
        let unique: HashSet<_> = codes.iter().collect();
        assert_eq!(unique.len(), codes.len());
        for code in codes {
            assert!((1..=2).contains(&code.len()), "{code}");
            if code.len() == 2 {
                assert!(!unique.contains(&code[..1].to_string()), "{code}");
            }
        }
    }

    #[test]
    fn all_capacity_boundaries_prefer_singles_and_never_exceed_two_keys() {
        for alphabet in ["AS", "A; ", "ASDF", "ASDFGHJKLQWERTYUIOPZXCVBNM"] {
            let n = alphabet.len();
            let mut previous = Vec::new();
            for count in 0..=n * n + 2 {
                let codes = pool(alphabet, count);
                check_codes(&codes);
                assert_eq!(codes.len(), count.min(n * n));
                assert!(codes
                    .iter()
                    .all(|code| code.chars().all(|c| alphabet.contains(c))));
                // An independent prefix-free capacity bound: each remaining
                // single consumes one of N branches, leaving N pairs per other branch.
                let singles = codes.iter().filter(|code| code.len() == 1).count();
                if count <= n {
                    assert_eq!(singles, count);
                    assert_eq!(codes.concat(), alphabet[..count]);
                } else if count <= n * n {
                    assert!(singles + (n - singles) * n >= count);
                    assert!(singles == 0 || singles + 1 + (n - singles - 1) * n < count);
                }
                for old in previous {
                    if !codes.contains(&old) {
                        assert_eq!(old.len(), 1, "existing pairs must stay fixed");
                        assert!(codes.iter().any(|code| code.starts_with(&old)));
                    }
                }
                previous = codes;
            }
        }
    }

    #[test]
    fn expansion_only_reassigns_the_single_that_becomes_a_prefix() {
        let config = Config {
            hint_alphabet: "ASD".into(),
            ..Config::default()
        };
        let mut hints = StableHints::default();
        for count in 1..=11 {
            let before = hints.assignments.clone();
            let ids: Vec<_> = (0..count).map(|i| i.to_string()).collect();
            hints.sync(&config, &ids);
            assert_eq!(hints.assignments.len(), count.min(9));
            check_codes(&hints.assignments.values().cloned().collect::<Vec<_>>());
            for (id, old) in before {
                if hints.codes.contains(&old) {
                    assert_eq!(hints.get(&id), old);
                } else {
                    assert_eq!(old.len(), 1);
                    assert!(hints.codes.iter().any(|code| code.starts_with(&old)));
                }
            }
            // Reordering and repeated inventories cannot reshuffle assignments.
            let before = hints.assignments.clone();
            hints.dirty = false;
            hints.sync(&config, &ids.into_iter().rev().collect::<Vec<_>>());
            assert_eq!(hints.assignments, before);
            assert!(!hints.dirty);
        }
        let before = hints.assignments.clone();
        let remaining: Vec<_> = before.keys().take(3).cloned().collect();
        hints.sync(&config, &remaining);
        for id in remaining {
            assert_eq!(hints.get(&id), before[&id]);
        }
    }

    #[test]
    fn old_long_and_per_position_caches_migrate_without_losing_compatible_hints() {
        let path = std::env::temp_dir().join(format!(
            "beaconhop-hints-{}-legacy.json",
            std::process::id()
        ));
        let old = serde_json::json!({
            "alphabet": "ASDF", "charsets": ["AS", "DF"], "extra": "Q",
            "codes": ["A", "S", "DA", "DS", "FA", "FS", "DDA"],
            "assignments": {"single": "A", "pair": "FA", "old-long": "DDA"}
        });
        std::fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
        let mut hints = StableHints::load(&path);
        assert!(hints.dirty);
        assert_eq!(hints.get("single"), "A");
        assert_eq!(hints.get("pair"), "FA");
        assert_eq!(hints.get("old-long"), "");
        let config = Config {
            hint_alphabet: "ASDF".into(),
            ..Config::default()
        };
        hints.sync(
            &config,
            &["single".into(), "pair".into(), "old-long".into()],
        );
        assert!(!hints.get("old-long").is_empty());
        check_codes(&hints.codes);
        std::fs::write(&path, serde_json::to_vec(&hints).unwrap()).unwrap();
        let restored = StableHints::load(&path);
        assert_eq!(restored.assignments, hints.assignments);
        assert!(!restored.dirty);
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
        assert_eq!(hints.assignments.len(), 16);
        assert!(hints
            .assignments
            .values()
            .all(|c| c.chars().all(|c| "ASDF".contains(c))));
    }
}
