//! Stable window slots; recency chooses a target, never a position.
use crate::model::{Bounds, Destination, Display};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewPanel {
    pub label: String,
    pub display: Display,
    pub bounds: Bounds,
    pub slots: Vec<Option<String>>,
}

#[derive(Default, Serialize, Deserialize)]
pub struct StableOverview {
    slots: HashMap<String, Vec<Option<String>>>,
}

pub fn display_label(id: &str) -> String {
    format!(
        "switcher-display-{}",
        id.as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}

pub fn is_panel(label: &str) -> bool {
    label == "switcher" || label.starts_with("switcher-display-")
}

pub fn coordinate_scale(display: &Display) -> f64 {
    // CG/AX coordinates are logical points; Windows monitor bounds are physical pixels.
    if cfg!(target_os = "windows") {
        display.scale.max(1.)
    } else {
        1.
    }
}

pub fn panel_bounds(display: &Display) -> Bounds {
    let scale = coordinate_scale(display);
    let width = (display.bounds.width / scale - 64.).max(1.) * scale;
    let height = (display.bounds.height / scale - 96.).max(1.) * scale;
    Bounds {
        x: display.bounds.x + (display.bounds.width - width) / 2.,
        y: display.bounds.y + (display.bounds.height - height) / 2.,
        width,
        height,
    }
}

impl StableOverview {
    pub fn retain_displays(&mut self, displays: &[Display]) {
        self.slots
            .retain(|id, _| displays.iter().any(|d| &d.id == id));
    }
    pub fn prepare(
        &mut self,
        displays: &[Display],
        windows: &[Destination],
        anchor: &str,
    ) -> Vec<OverviewPanel> {
        let mut displays = displays.to_vec();
        // Physical left-to-right order, then top-to-bottom for stacked displays.
        displays.sort_by(|a, b| {
            a.bounds
                .x
                .total_cmp(&b.bounds.x)
                .then_with(|| a.bounds.y.total_cmp(&b.bounds.y))
                .then_with(|| a.id.cmp(&b.id))
        });
        let mut panels = Vec::new();
        for display in &displays {
            let mut local: Vec<_> = windows
                .iter()
                .filter(|w| {
                    w.display_id == display.id
                        || (display.id == anchor && !displays.iter().any(|d| d.id == w.display_id))
                })
                .collect();
            // Only the first placement uses native position. Later movement within
            // this screen, title changes, focus and Z-order cannot reshuffle slots.
            local.sort_by(|a, b| {
                a.bounds
                    .y
                    .total_cmp(&b.bounds.y)
                    .then_with(|| a.bounds.x.total_cmp(&b.bounds.x))
                    .then_with(|| a.id.cmp(&b.id))
            });
            let slots = self.slots.entry(display.id.clone()).or_default();
            let live: HashSet<_> = local.iter().map(|w| &w.id).collect();
            let mut assigned = HashSet::new();
            for slot in slots.iter_mut() {
                if slot
                    .as_ref()
                    .is_some_and(|id| live.contains(id) && assigned.insert(id.clone()))
                {
                    continue;
                }
                *slot = None;
            }
            for w in local {
                if assigned.contains(&w.id) {
                    continue;
                }
                if let Some(empty) = slots.iter_mut().find(|s| s.is_none()) {
                    *empty = Some(w.id.clone());
                } else {
                    slots.push(Some(w.id.clone()));
                }
            }
            // Keep holes and capacity, including trailing ones, until a screen is
            // empty. This avoids resizing the grid when a single window closes.
            if slots.iter().all(Option::is_none) {
                slots.clear();
            }
            panels.push(OverviewPanel {
                label: if display.id == anchor {
                    "switcher".into()
                } else {
                    display_label(&display.id)
                },
                display: display.clone(),
                bounds: panel_bounds(display),
                slots: slots.clone(),
            });
        }
        panels
    }
}

/// Replace only this panel's geometry. Another screen's publication must survive.
pub fn merge_navigation(
    panels: &[OverviewPanel],
    label: &str,
    navigation: &mut HashMap<String, Bounds>,
    rectangles: HashMap<String, Bounds>,
) {
    let Some(panel) = panels.iter().find(|p| p.label == label) else {
        return;
    };
    let ids: HashSet<_> = panel.slots.iter().flatten().collect();
    navigation.retain(|id, _| !ids.contains(id));
    let scale = coordinate_scale(&panel.display);
    for (id, rect) in rectangles {
        if ids.contains(&id)
            && [rect.x, rect.y, rect.width, rect.height]
                .iter()
                .all(|v| v.is_finite())
            && rect.width > 0.
            && rect.height > 0.
        {
            navigation.insert(
                id,
                Bounds {
                    x: panel.bounds.x + rect.x * scale,
                    y: panel.bounds.y + rect.y * scale,
                    width: rect.width * scale,
                    height: rect.height * scale,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    pub fn displays() -> Vec<Display> {
        vec![
            Display {
                id: "left".into(),
                bounds: Bounds {
                    x: -1600.,
                    y: 0.,
                    width: 1600.,
                    height: 1000.,
                },
                scale: 1.,
                ..Default::default()
            },
            Display {
                id: "right".into(),
                bounds: Bounds {
                    x: 0.,
                    y: 0.,
                    width: 1920.,
                    height: 1080.,
                },
                scale: 1.,
                ..Default::default()
            },
        ]
    }
    fn window(id: &str, display: &str) -> Destination {
        Destination {
            id: id.into(),
            display_id: display.into(),
            ..Default::default()
        }
    }
    #[test]
    fn focus_inventory_order_closing_and_restarting_preserve_slots() {
        let mut stable = StableOverview::default();
        let mut windows = vec![
            window("a", "left"),
            window("b", "left"),
            window("c", "right"),
        ];
        let first = stable.prepare(&displays(), &windows, "right");
        windows.reverse();
        windows[0].title = "Renamed".into();
        let second = stable.prepare(&displays(), &windows, "left");
        assert_eq!(first[0].slots, second[0].slots);
        windows.retain(|w| w.id != "a");
        let closed = stable.prepare(&displays(), &windows, "right");
        assert_eq!(closed[0].slots, vec![None, Some("b".into())]);
        assert_eq!(closed[0].slots.len(), first[0].slots.len());
        let mut restored: StableOverview =
            serde_json::from_slice(&serde_json::to_vec(&stable).unwrap()).unwrap();
        windows.push(window("d", "left"));
        assert_eq!(
            restored.prepare(&displays(), &windows, "right")[0].slots,
            vec![Some("d".into()), Some("b".into())]
        );
        windows.iter_mut().find(|w| w.id == "b").unwrap().display_id = "right".into();
        let moved = restored.prepare(&displays(), &windows, "right");
        assert!(!moved[0].slots.contains(&Some("b".into())));
        assert!(moved[1].slots.contains(&Some("b".into())));
    }
    #[test]
    fn unplugged_and_unknown_displays_fall_back_without_losing_windows() {
        let mut stable = StableOverview::default();
        let panels = stable.prepare(
            &displays()[1..],
            &[window("a", "left"), window("b", "unknown")],
            "right",
        );
        assert_eq!(panels.len(), 1);
        assert_eq!(panels[0].slots.iter().flatten().count(), 2);
    }
    #[test]
    fn current_scope_does_not_forget_slots_on_the_other_screen() {
        let mut stable = StableOverview::default();
        let mut windows = vec![
            window("a", "left"),
            window("b", "left"),
            window("c", "right"),
        ];
        let original = stable.prepare(&displays(), &windows, "left");
        stable.prepare(&displays()[1..], &windows[2..], "right");
        windows[0].bounds.x = 200.; // Moving within a screen must not reallocate its slot.
        let returned = stable.prepare(&displays(), &windows, "left");
        assert_eq!(original[0].slots, returned[0].slots);
    }
    #[test]
    fn geometry_merges_across_screens_and_ignores_foreign_ids() {
        let panels = StableOverview::default().prepare(
            &displays(),
            &[window("a", "left"), window("b", "right")],
            "right",
        );
        let mut navigation = HashMap::new();
        let rect = Bounds {
            x: 20.,
            y: 120.,
            width: 200.,
            height: 150.,
        };
        merge_navigation(
            &panels,
            &panels[0].label,
            &mut navigation,
            HashMap::from([("a".into(), rect.clone())]),
        );
        merge_navigation(
            &panels,
            "switcher",
            &mut navigation,
            HashMap::from([("a".into(), rect.clone()), ("b".into(), rect)]),
        );
        assert_eq!(navigation.len(), 2);
        assert!(navigation["a"].x < 0.);
        assert!(navigation["b"].x > 0.);
        merge_navigation(&panels, "switcher", &mut navigation, HashMap::new());
        assert!(navigation.contains_key("a"));
        assert!(!navigation.contains_key("b"));
    }
}
