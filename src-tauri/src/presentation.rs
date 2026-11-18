//! A native panel may be exposed only after its current web layout commits.
use std::collections::HashMap;

#[derive(Default)]
pub struct Presentation {
    pub generation: u64,
    pub session_id: u64,
    pub search: bool,
    pub started: Option<std::time::Instant>,
    pub panels: HashMap<String, (f64, f64, bool)>,
}
impl Presentation {
    pub fn begin(
        &mut self,
        session_id: u64,
        search: bool,
        panels: HashMap<String, (f64, f64, bool)>,
    ) {
        self.generation += 1;
        self.started = Some(std::time::Instant::now());
        self.session_id = session_id;
        self.search = search;
        self.panels = panels;
    }
    pub fn ready(&mut self, generation: u64, label: &str) -> bool {
        if self.generation != generation {
            return false;
        }
        let Some(panel) = self.panels.get_mut(label) else {
            return false;
        };
        panel.2 = true;
        self.panels.values().all(|p| p.2)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn waits_for_every_display_and_rejects_previous_open_and_cancelled_frames() {
        let panels = HashMap::from([
            ("switcher".into(), (1200., 800., false)),
            ("second".into(), (900., 700., false)),
        ]);
        let mut p = Presentation::default();
        p.begin(1, false, panels.clone());
        let old = p.generation;
        assert!(!p.ready(old, "switcher"));
        assert!(!p.ready(old, "unrelated"));
        p.begin(2, false, panels);
        assert!(!p.ready(old, "second"));
        assert!(!p.ready(p.generation, "second"));
        assert!(p.ready(p.generation, "switcher"));
        p.panels.clear();
        assert!(!p.ready(p.generation, "switcher"));
    }
}
