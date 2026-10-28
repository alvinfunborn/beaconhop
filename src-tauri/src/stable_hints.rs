use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

// Reserve two branches at each depth. Existing short codes never become prefixes
// when new windows arrive (e.g. A stays A; expansion happens under N and M).
fn pool(alphabet: &str, count: usize) -> Vec<String> {
    let chars: Vec<_> = alphabet.chars().collect();
    if chars.len() < 4 {
        return vec![];
    }
    let split = chars.len() - 2;
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
            let state: Self = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
            let letters: HashSet<_> = state.alphabet.chars().collect();
            if !(4..=26).contains(&letters.len())
                || letters.len() != state.alphabet.len()
                || !state.alphabet.bytes().all(|c| c.is_ascii_uppercase())
                || state.codes.len() > 8192
                || state.codes != pool(&state.alphabet, state.codes.len())
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
    pub fn sync(&mut self, alphabet: &str, ids: &[String]) {
        if self.alphabet != alphabet {
            *self = Self {
                alphabet: alphabet.into(),
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
            self.codes = pool(alphabet, ids.len());
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
            let shortest = free.iter().map(|s| s.len()).min().unwrap();
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
        self.assignments[id].clone()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_codes_survive_growth_reorder_rename_scope_and_restart() {
        let alphabet = "ASDFGHJKLQWERTYUIOPZXCVBNM";
        let mut hints = StableHints::default();
        let ids: Vec<_> = (0..10).map(|i| format!("mac:1:{i}")).collect();
        hints.sync(alphabet, &ids);
        let before = hints.assignments.clone();
        let mut more: Vec<_> = (0..150).map(|i| format!("mac:1:{i}")).collect();
        more.reverse();
        hints.sync(alphabet, &more);
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
        hints.sync(alphabet, &[]);
        assert_eq!(hints.assignments.len(), 150);
        hints.sync("ASDF", &more);
        assert!(hints
            .assignments
            .values()
            .all(|c| c.chars().all(|c| "ASDF".contains(c))));
    }
}
