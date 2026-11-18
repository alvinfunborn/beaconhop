use super::*;
use crate::config::{ALT, CTRL, SUPER};

fn key(name: &str, mods: u8, down: bool) -> KeyEvent {
    KeyEvent {
        key: name.into(),
        code: name.bytes().map(u32::from).sum(),
        modifiers: mods,
        down,
        repeat: false,
    }
}
fn engine() -> Engine {
    let mut e = Engine::new(Config::default());
    e.update(Snapshot {
        focused_id: Some("w0".into()),
        current_display: "screen".into(),
        windows: (0..6)
            .map(|i| Destination {
                id: format!("w{i}"),
                pid: 100 + i,
                title: format!("window {i}"),
                app_name: if i < 3 { "Editor" } else { "Browser" }.into(),
                app_id: if i < 3 { "editor" } else { "browser" }.into(),
                display_id: "screen".into(),
                desktop_id: if i < 3 { "d0" } else { "d1" }.into(),
                current_desktop: Some(i < 3),
                ..Default::default()
            })
            .collect(),
        desktops: (0..3)
            .map(|i| Desktop {
                id: format!("d{i}"),
                name: format!("Desktop {i}"),
                display_id: "screen".into(),
                current: i == 0,
                label: Some(DesktopLabel {
                    number: i + 1,
                    full_screen: false,
                }),
                ..Default::default()
            })
            .collect(),
        displays: vec![Display {
            id: "screen".into(),
            ..Default::default()
        }],
        ..Default::default()
    });
    e.tab_apps.insert("editor".into());
    e.tab_apps.insert("browser".into());
    e
}
fn tabs(e: &Engine) -> Vec<Destination> {
    (0..3)
        .map(|i| {
            let mut w = e.session.origin.clone().unwrap();
            w.id = format!("tab{i}");
            w.title = format!("工作 {i}");
            w.content = Some(ContentRef {
                provider: "test".into(),
                instance: "epoch".into(),
                context: "context".into(),
                item: i.to_string(),
                parent_id: e.session.origin.as_ref().unwrap().id.clone(),
                subtitle: format!("https://example.test/{i}"),
                active: i == 0,
                preview: false,
                ..Default::default()
            });
            w
        })
        .collect()
}

#[test]
fn vscode_ctrl_tab_is_consumed_before_editor_keybindings_in_both_directions() {
    for reverse in [false, true] {
        let mut e = engine();
        e.snapshot.windows[0].app_id = "com.microsoft.VSCode".into();
        e.tab_apps = ["com.microsoft.vscode".into()].into();
        let modifiers = CTRL | if reverse { SHIFT } else { 0 };
        let down = e.handle(key("Tab", modifiers, true));
        assert!(down.consumed, "VS Code must not receive the shortcut down");
        assert_eq!(e.session.layer, Layer::Tabs);
        assert!(down
            .actions
            .iter()
            .any(|a| matches!(a, Action::LoadTabs(_, _))));
        assert!(e.handle(key("Tab", modifiers, false)).consumed);
        // Autorepeat and a further Tab are intercepted while inventory is loading.
        let mut repeat = key("Tab", modifiers, true);
        repeat.repeat = true;
        assert!(e.handle(repeat).consumed);
        assert!(e.handle(key("Tab", modifiers, false)).consumed);
        e.tabs_loaded(e.session.session_id, Ok(tabs(&e)));
        assert!(e.handle(key("Escape", modifiers, true)).consumed);
        assert!(e.handle(key("Escape", modifiers, false)).consumed);
        e.handle(key("Control", 0, false));
        assert!(!e.handle(key("A", 0, true)).consumed);
    }
}

#[test]
fn ctrl_tab_arrows_use_grid_geometry_and_release_commits_the_selected_tab() {
    let mut e = engine();
    e.handle(key("Tab", CTRL, true));
    let mut items = tabs(&e);
    let mut last = items[0].clone();
    last.id = "tab3".into();
    last.content.as_mut().unwrap().item = "3".into();
    last.content.as_mut().unwrap().active = false;
    items.push(last);
    e.tabs_loaded(e.session.session_id, Ok(items));
    e.session.selected = Some("tab0".into());
    e.navigation = (0..4)
        .map(|i| {
            (
                format!("tab{i}"),
                Bounds {
                    x: (i % 2) as f64 * 260.,
                    y: (i / 2) as f64 * 220.,
                    width: 246.,
                    height: 206.,
                },
            )
        })
        .collect();
    for (direction, wanted) in [
        ("ArrowRight", "tab1"),
        ("ArrowDown", "tab3"),
        ("ArrowLeft", "tab2"),
        ("ArrowUp", "tab0"),
    ] {
        assert!(e.handle(key(direction, CTRL, true)).consumed);
        assert_eq!(e.session.selected.as_deref(), Some(wanted));
        assert!(e.handle(key(direction, CTRL, false)).consumed);
    }
    e.handle(key("ArrowDown", CTRL, true));
    e.handle(key("ArrowDown", CTRL, false));
    let response = e.handle(key("Control", 0, false));
    assert!(response
        .actions
        .iter()
        .any(|action| { matches!(action, Action::Activate(_, target) if target.id == "tab2") }));
}
fn hint(e: &mut Engine, id: &str, mods: u8) -> String {
    let hint = e
        .session
        .windows
        .iter()
        .find(|w| w.window.id == id)
        .unwrap()
        .hint
        .clone();
    assert_eq!(hint.len(), 1);
    let actions = e.handle(key(&hint, mods, true)).actions;
    assert!(matches!(actions.first(), Some(Action::Activate(..))));
    hint
}
#[test]
fn win_alt_ctrl_and_ctrl_win_select_four_distinct_layers() {
    for (mods, layer, count) in [
        (SUPER, Layer::Windows, 6),
        (ALT, Layer::Application, 3),
        (CTRL, Layer::Tabs, 0),
        (CTRL | SUPER, Layer::Desktops, 3),
    ] {
        let mut e = engine();
        let response = e.handle(key("Tab", mods, true));
        assert!(response.consumed);
        assert_eq!(e.session.layer, layer);
        assert_eq!(e.session.windows.len(), count);
        if layer == Layer::Application {
            assert!(e
                .session
                .windows
                .iter()
                .all(|w| w.window.app_id == "editor"));
        }
    }
}

#[test]
fn desktop_chord_does_not_commit_before_a_remapped_hint_arrives() {
    let mut e = engine();
    e.handle(key("Tab", CTRL | SUPER, true));
    e.handle(key("Tab", CTRL | SUPER, false));
    assert_eq!(e.session.selected.as_deref(), Some("desktop:d1"));
    // Karabiner's Ctrl+A -> Cmd+A releases Ctrl before delivering A.
    // The held Command key still owns this gesture; A must select desktop d0.
    assert!(e.handle(key("Control", SUPER, false)).actions.is_empty());
    assert_eq!(e.session.mode, Mode::Held);
    let h = e
        .session
        .windows
        .iter()
        .find(|w| w.window.id == "desktop:d0")
        .unwrap()
        .hint
        .clone();
    let result = e.handle(key(&h, SUPER, true));
    assert!(result.consumed);
    assert!(
        matches!(&result.actions[..], [Action::Activate(_, target), ..] if target.id == "desktop:d0")
    );
}

#[test]
fn desktop_chord_commits_exact_selection_once_after_either_release_order() {
    for (first, remaining, last) in [("Control", SUPER, "Super"), ("Super", CTRL, "Control")] {
        let mut e = engine();
        e.handle(key("Tab", CTRL | SUPER, true));
        e.handle(key("Tab", CTRL | SUPER, false));
        e.navigate(1);
        let selected = e.session.selected.clone().unwrap();
        assert!(e.handle(key(first, remaining, false)).actions.is_empty());
        assert_eq!(e.session.mode, Mode::Held);
        let result = e.handle(key(last, 0, false));
        assert!(
            matches!(&result.actions[..], [Action::Activate(_, target), ..] if target.id == selected)
        );
        assert!(e.handle(key(last, 0, false)).actions.is_empty());
    }
}
#[test]
fn shortcuts_pass_through_when_no_plugin_or_layer_disabled() {
    let mut e = engine();
    e.tab_apps.clear();
    assert!(!e.handle(key("Tab", CTRL, true)).consumed);
    assert!(!e.handle(key("Backquote", CTRL, true)).consumed);
    e.config.application_enabled = false;
    assert!(!e.handle(key("Tab", ALT, true)).consumed);
    e.snapshot.desktops.clear();
    assert!(!e.handle(key("Tab", CTRL | SUPER, true)).consumed);
}

#[test]
fn desktop_search_accepts_translated_labels_and_preserves_custom_names() {
    let mut e = engine();
    e.snapshot.desktops[1].label.as_mut().unwrap().full_screen = true;
    e.snapshot.desktops[2].label = None;
    e.snapshot.desktops[2].name = "Writing".into();
    e.open_layer(Layer::Desktops, Mode::Search, false, false, None);
    for (query, id) in [
        ("桌面 1", "desktop:d0"),
        ("全屏", "desktop:d1"),
        ("zhuomian", "desktop:d0"),
        ("Writing", "desktop:d2"),
    ] {
        e.search(query.into());
        assert_eq!(e.results().len(), 1, "{query}");
        assert_eq!(e.results()[0].window.id, id);
    }
}

#[test]
fn desktop_overviews_keep_exact_membership_and_filter_nonvisible_or_excluded_windows() {
    let mut e = engine();
    e.snapshot.windows[0].minimized = true;
    e.snapshot.windows[1].hidden = true;
    e.config.excluded_apps.push("Browser".into());
    e.snapshot.displays.push(Display {
        id: "other".into(),
        ..Default::default()
    });
    e.open_layer(Layer::Desktops, Mode::Search, false, false, None);
    let previews = &e.session.desktop_previews;
    assert_eq!(previews.len(), 3);
    assert_eq!(previews["desktop:d0"].windows.len(), 1);
    assert_eq!(previews["desktop:d0"].windows[0].id, "w2");
    assert_eq!(previews["desktop:d0"].displays.len(), 1);
    assert_eq!(previews["desktop:d0"].displays[0].id, "screen");
    assert!(previews["desktop:d1"].windows.is_empty());
    assert!(previews["desktop:d2"].windows.is_empty());
    e.snapshot.desktops[0].display_id.clear(); // Windows desktops cover all monitors.
    e.open_layer(Layer::Desktops, Mode::Search, false, false, None);
    assert_eq!(e.session.desktop_previews["desktop:d0"].displays.len(), 2);
    e.open_layer(Layer::Windows, Mode::Search, false, false, None);
    assert!(e.session.desktop_previews.is_empty());
}
#[test]
fn shared_macos_desktop_previews_include_both_displays_and_their_windows() {
    let mut e = engine();
    e.snapshot.displays.push(Display {
        id: "external".into(),
        ..Default::default()
    });
    e.snapshot.windows[1].display_id = "external".into();
    e.snapshot.desktops[0].display_ids = vec!["screen".into(), "external".into()];
    e.open_layer(Layer::Desktops, Mode::Held, false, false, None);
    let preview = &e.session.desktop_previews["desktop:d0"];
    assert_eq!(preview.displays.len(), 2);
    assert!(preview.windows.iter().any(|w| w.display_id == "external"));
    assert!(preview.windows.iter().all(|w| w.desktop_id == "d0"));
    // The native activation anchor remains usable for Mission Control and SB.
    assert_eq!(e.session.windows[0].window.display_id, "screen");
    e.snapshot.desktops[0].display_ids = vec!["screen".into()];
    e.open_layer(Layer::Desktops, Mode::Search, false, false, None);
    assert_eq!(e.session.desktop_previews["desktop:d0"].displays.len(), 1);
}

#[test]
fn async_ctrl_tab_preserves_cycle_count_and_commits_only_after_inventory() {
    let mut e = engine();
    e.handle(key("Tab", CTRL, true));
    e.handle(key("Tab", CTRL, false));
    e.handle(key("Tab", CTRL, true));
    e.handle(key("Tab", CTRL, false));
    assert!(e.handle(key("Control", 0, false)).actions.is_empty());
    let items = tabs(&e);
    let actions = e.tabs_loaded(e.session.session_id, Ok(items));
    assert!(matches!(&actions[..],[Action::Activate(_,w)] if w.id=="tab2"));
}
#[test]
fn reverse_ctrl_tab_selects_previous_and_typing_cancels_a_delayed_commit() {
    let mut e = engine();
    e.handle(key("Tab", CTRL | SHIFT, true));
    let items = tabs(&e);
    e.tabs_loaded(e.session.session_id, Ok(items));
    assert_eq!(e.session.selected.as_deref(), Some("tab2"));
    let mut e = engine();
    e.handle(key("Tab", CTRL, true));
    e.handle(key("Tab", CTRL, false));
    e.handle(key("Control", 0, false));
    let items = tabs(&e);
    let r = e.handle(key("X", 0, true));
    assert!(!r.consumed);
    assert!(e.tabs_loaded(e.session.session_id, Ok(items)).is_empty());
    assert_eq!(e.session.mode, Mode::Inactive);
}
#[test]
fn search_survives_release_and_loading_cancellation_cannot_resurrect_it() {
    for (mods, layer) in [
        (SUPER, Layer::Windows),
        (ALT, Layer::Application),
        (CTRL, Layer::Tabs),
        (CTRL | SUPER, Layer::Desktops),
    ] {
        let mut e = engine();
        e.handle(key("Backquote", mods, true));
        assert_eq!(e.session.layer, layer);
        assert_eq!(e.session.mode, Mode::Search);
        e.handle(key("Backquote", 0, false));
        e.handle(key("Control", 0, false));
        assert_eq!(e.session.mode, Mode::Search);
    }
    let mut e = engine();
    e.handle(key("Backquote", CTRL, true));
    let items = tabs(&e);
    assert!(e.handle(key("A", CTRL, true)).consumed); // no typing leaks while loading
    assert!(e.handle(key("Escape", 0, true)).consumed);
    assert!(e.tabs_loaded(e.session.session_id, Ok(items)).is_empty());
}
#[test]
fn alternative_continuation_keys_open_sticky_hints_on_keydown() {
    for (trigger, modifier) in [("Control", CTRL), ("Enter", 0)] {
        let mut e = engine();
        e.config.tabs_hint_keys = vec!["Control".into(), "Enter".into()];
        e.config.validate().unwrap();
        e.handle(key("Tab", SUPER, true));
        e.handle(key("Tab", SUPER, false));
        let h = hint(&mut e, "w1", SUPER);
        e.finish_activation(e.session.session_id, Some("w1".into()));
        let actions = e.handle(key(trigger, SUPER | modifier, true)).actions;
        let [Action::Continue(id, target, Layer::Tabs)] = &actions[..] else {
            panic!("{actions:?}");
        };
        e.continue_layer(*id, target.clone(), Layer::Tabs);
        let items = tabs(&e);
        e.tabs_loaded(e.session.session_id, Ok(items));
        for name in [&h, trigger] {
            let mut event = key(name, SUPER | modifier, true);
            event.repeat = true;
            assert!(e.handle(event).actions.is_empty());
        }
        assert!(e.handle(key(&h, SUPER | modifier, false)).consumed);
        assert!(e.handle(key("Super", modifier, false)).actions.is_empty());
        assert!(e.handle(key(trigger, 0, false)).actions.is_empty());
        assert_eq!(e.session.mode, Mode::Held);
        hint(&mut e, "tab1", 0);
        assert_eq!(e.session.mode, Mode::Inactive);
    }
}
#[test]
fn selected_tab_hands_its_native_parent_to_sb_and_failed_activation_disarms_it() {
    for (success, binding) in [
        (true, "HintLeftKey"),
        (true, "HintRightKey"),
        (false, "HintLeftKey"),
        (false, "HintRightKey"),
    ] {
        let mut e = engine();
        e.config.screen_buoy.enabled = true;
        e.open_layer(Layer::Tabs, Mode::Held, false, true, None);
        let items = tabs(&e);
        e.tabs_loaded(e.session.session_id, Ok(items));
        let h = hint(&mut e, "tab1", 0);
        e.finish_activation(
            e.session.session_id,
            Some(if success { "w0" } else { "w5" }.into()),
        );
        let next =
            crate::hint_keys::binding_key(binding, &h, &e.config.screen_buoy.neighbours).unwrap();
        let started = e.handle(key(&next, 0, true)).actions;
        e.handle(key(&h, 0, false));
        let actions = e.handle(key(&next, 0, false)).actions;
        if success {
            assert!(
                matches!(&started[..],[Action::ScreenBuoy(_,w,_)] if w.id=="w0" && w.content.is_none())
            );
        } else {
            assert!(!started
                .iter()
                .chain(&actions)
                .any(|a| matches!(a, Action::ScreenBuoy(..))));
        }
    }
}

#[test]
fn every_source_layer_can_continue_on_keydown_before_releasing_the_hint() {
    for source in [
        Layer::Desktops,
        Layer::Windows,
        Layer::Application,
        Layer::Tabs,
    ] {
        for (trigger, mods, destination) in [
            ("Super", SUPER, Layer::Windows),
            ("Alt", ALT, Layer::Application),
            ("Control", CTRL, Layer::Tabs),
        ] {
            if source == Layer::Desktops && destination == Layer::Tabs {
                continue; // Desktops have no tab adapter.
            }
            let mut e = engine();
            e.open_layer(source, Mode::Held, false, true, None);
            let target = match source {
                Layer::Desktops => "desktop:d0",
                Layer::Tabs => {
                    let items = tabs(&e);
                    e.tabs_loaded(e.session.session_id, Ok(items));
                    "tab1"
                }
                _ => "w1",
            };
            let h = hint(&mut e, target, 0);
            let actions = e.handle(key(trigger, mods, true)).actions;
            let [Action::Continue(id, target, layer)] = &actions[..] else {
                panic!("{source:?} -> {destination:?}: {actions:?}");
            };
            assert_eq!(*layer, destination);
            assert!(!e.continue_layer(*id, target.clone(), *layer).is_empty());
            assert_eq!(e.session.layer, destination);
            assert!(e.session.sticky);
            assert!(e.handle(key(&h, mods, false)).actions.is_empty());
            assert!(e.handle(key(trigger, 0, false)).actions.is_empty());
            assert_eq!(e.session.mode, Mode::Held);
        }
    }
}

#[test]
fn continuation_drains_every_release_order_and_held_shortcut_repeats() {
    for trigger in ["Alt", "Enter"] {
        for order in [
            [0, 1, 2],
            [0, 2, 1],
            [1, 0, 2],
            [1, 2, 0],
            [2, 0, 1],
            [2, 1, 0],
        ] {
            let mut e = engine();
            e.config.application_hint_keys = vec![trigger.into()];
            e.handle(key("Super", SUPER, true));
            e.handle(key("Tab", SUPER, true)); // Keep the invocation key held, too.
            let h = hint(&mut e, "w1", SUPER);
            e.finish_activation(e.session.session_id, Some("w1".into()));
            let mut mods = SUPER | if trigger == "Alt" { ALT } else { 0 };
            let actions = e.handle(key(trigger, mods, true)).actions;
            let [Action::Continue(id, target, layer)] = &actions[..] else {
                panic!("{actions:?}")
            };
            e.continue_layer(*id, target.clone(), *layer);
            let session_id = e.session.session_id;
            let selected = e.session.selected.clone();
            for name in ["Tab", &h, trigger] {
                let mut repeat = key(name, mods, true);
                repeat.repeat = true;
                let r = e.handle(repeat);
                assert!(r.actions.is_empty());
                assert_eq!(r.consumed, name != "Alt");
            }
            assert_eq!(e.session.session_id, session_id);
            assert_eq!(e.session.selected, selected);
            assert!(e.handle(key("Tab", mods, false)).consumed);
            for index in order {
                let name = [&h, trigger, "Super"][index];
                if name == "Super" {
                    mods &= !SUPER;
                }
                if name == "Alt" {
                    mods &= !ALT;
                }
                let r = e.handle(key(name, mods, false));
                assert!(r.actions.is_empty());
                assert_eq!(r.consumed, !matches!(name, "Alt" | "Super"));
                assert_eq!(e.session.mode, Mode::Held);
                assert_eq!(e.session.session_id, session_id);
                assert_eq!(e.session.selected, selected);
            }
            // The same physical hint becomes usable again after its release.
            hint(&mut e, "w1", 0);
        }
    }
}

#[test]
fn fresh_tab_and_hint_work_while_old_modifiers_and_hint_remain_held() {
    let mut e = engine();
    e.handle(key("Super", SUPER, true));
    e.handle(key("Tab", SUPER, true));
    e.handle(key("Tab", SUPER, false));
    let old_hint = hint(&mut e, "w1", SUPER);
    let actions = e.handle(key("Control", SUPER | CTRL, true)).actions;
    let [Action::Continue(id, target, layer)] = &actions[..] else {
        panic!("{actions:?}")
    };
    e.continue_layer(*id, target.clone(), *layer);
    let items = tabs(&e);
    e.tabs_loaded(e.session.session_id, Ok(items));
    let id = e.session.session_id;
    assert_eq!(e.session.selected.as_deref(), Some("tab0"));
    assert!(e.handle(key("Tab", SUPER | CTRL, true)).consumed);
    assert_eq!(e.session.layer, Layer::Tabs); // Must not reinterpret old Super+Ctrl as desktop shortcut.
    assert_eq!(e.session.session_id, id);
    assert_eq!(e.session.selected.as_deref(), Some("tab1"));
    e.handle(key("Tab", SUPER | CTRL, false));
    let fresh = e
        .session
        .windows
        .iter()
        .find(|w| w.hint != old_hint)
        .unwrap()
        .window
        .id
        .clone();
    hint(&mut e, &fresh, SUPER | CTRL);
    for (name, mods) in [
        (&old_hint[..], SUPER | CTRL),
        ("Control", SUPER),
        ("Super", 0),
    ] {
        assert!(e.handle(key(name, mods, false)).actions.is_empty());
    }
    assert_eq!(e.session.mode, Mode::Inactive);
    assert_eq!(e.session.selected.as_deref(), Some(fresh.as_str()));
}

#[test]
fn old_releases_do_not_commit_tabs_that_finish_loading_later() {
    let mut e = engine();
    e.handle(key("Tab", SUPER, true));
    e.handle(key("Tab", SUPER, false));
    let h = hint(&mut e, "w1", SUPER);
    let actions = e.handle(key("Control", SUPER | CTRL, true)).actions;
    let [Action::Continue(id, target, layer)] = &actions[..] else {
        panic!("{actions:?}")
    };
    e.continue_layer(*id, target.clone(), *layer);
    let items = tabs(&e);
    for (name, mods) in [(&h[..], SUPER | CTRL), ("Super", CTRL), ("Control", 0)] {
        assert!(e.handle(key(name, mods, false)).actions.is_empty());
    }
    let actions = e.tabs_loaded(e.session.session_id, Ok(items));
    assert!(!actions.iter().any(|a| matches!(a, Action::Activate(..))));
    assert_eq!(e.session.mode, Mode::Held);
    assert!(e.session.sticky);
}

#[test]
fn invalidated_activation_or_new_input_cannot_reopen_a_queued_continuation() {
    for cancel in ["activation", "Escape", "X", "new-session"] {
        let mut e = engine();
        e.open(Mode::Held, false);
        hint(&mut e, "w1", SUPER);
        let actions = e.handle(key("Alt", SUPER | ALT, true)).actions;
        let [Action::Continue(id, target, layer)] = &actions[..] else {
            panic!("{actions:?}")
        };
        match cancel {
            "activation" => e.clear_extension(), // Runtime rejects failed/unverified plugin activation.
            "new-session" => {
                e.open(Mode::Search, false);
            }
            name => {
                assert!(e.handle(key(name, SUPER | ALT, true)).consumed);
            }
        }
        assert!(
            e.continue_layer(*id, target.clone(), *layer).is_empty(),
            "{cancel}"
        );
    }
}

#[test]
fn consecutive_bh_layers_can_handoff_to_sb_with_all_previous_keys_still_held() {
    let mut e = engine();
    e.config.screen_buoy.enabled = true;
    e.config.screen_buoy.keys = vec!["Enter".into()];
    e.handle(key("Super", SUPER, true));
    e.handle(key("Tab", SUPER, true));
    e.handle(key("Tab", SUPER, false));
    let first = hint(&mut e, "w1", SUPER);
    let actions = e.handle(key("Alt", SUPER | ALT, true)).actions;
    let [Action::Continue(id, target, layer)] = &actions[..] else {
        panic!("{actions:?}")
    };
    e.continue_layer(*id, target.clone(), *layer);
    let second = hint(&mut e, "w2", SUPER | ALT);
    let actions = e.handle(key("Control", SUPER | ALT | CTRL, true)).actions;
    let [Action::Continue(id, target, layer)] = &actions[..] else {
        panic!("{actions:?}")
    };
    e.continue_layer(*id, target.clone(), *layer);
    let items = tabs(&e);
    e.tabs_loaded(e.session.session_id, Ok(items));
    let target = e
        .session
        .windows
        .iter()
        .find(|w| w.hint != first && w.hint != second)
        .unwrap()
        .window
        .id
        .clone();
    let third = hint(&mut e, &target, SUPER | ALT | CTRL);
    let actions = e.handle(key("Enter", SUPER | ALT | CTRL, true)).actions;
    let [Action::ScreenBuoy(_, target, held)] = &actions[..] else {
        panic!("{actions:?}")
    };
    assert_eq!(target.id, "w2");
    for name in [
        &first[..],
        &second,
        &third,
        "Super",
        "Alt",
        "Control",
        "Enter",
    ] {
        assert!(held.contains(&key(name, 0, true).code));
        let mut event = key(name, SUPER | ALT | CTRL, true);
        event.repeat = true;
        assert!(e.handle(event).actions.is_empty());
        assert!(e.sb_pending);
    }
    for (name, mods) in [
        (&first[..], SUPER | ALT | CTRL),
        (&second, SUPER | ALT | CTRL),
        (&third, SUPER | ALT | CTRL),
        ("Enter", SUPER | ALT | CTRL),
        ("Control", SUPER | ALT),
        ("Alt", SUPER),
        ("Super", 0),
    ] {
        assert!(e.handle(key(name, mods, false)).actions.is_empty());
        assert!(e.sb_pending);
    }
    // A released modifier can start a fresh global shortcut normally.
    e.handle(key("Super", SUPER, true));
    assert!(e.handle(key("Tab", SUPER, true)).consumed);
    assert_eq!(e.session.layer, Layer::Windows);
    assert_eq!(e.session.mode, Mode::Held);
}
#[test]
fn every_hint_layer_can_enter_sb_with_desktop_or_native_window_scope() {
    for layer in [
        Layer::Desktops,
        Layer::Windows,
        Layer::Application,
        Layer::Tabs,
    ] {
        for binding in ["HintLeftKey", "HintRightKey", "Enter"] {
            let mut e = engine();
            e.config.screen_buoy.enabled = true;
            e.config.screen_buoy.keys.push("Enter".into());
            e.open_layer(layer, Mode::Held, false, true, None);
            if layer == Layer::Tabs {
                let items = tabs(&e);
                e.tabs_loaded(e.session.session_id, Ok(items));
            }
            let id = match layer {
                Layer::Desktops => "desktop:d2",
                Layer::Tabs => "tab1",
                _ => "w1",
            };
            let h = hint(&mut e, id, 0);
            e.finish_activation(
                e.session.session_id,
                if layer == Layer::Desktops {
                    None
                } else {
                    Some(if layer == Layer::Tabs { "w0" } else { "w1" }.into())
                },
            );
            let trigger =
                crate::hint_keys::binding_key(binding, &h, &e.config.screen_buoy.neighbours)
                    .unwrap();
            let actions = e.handle(key(&trigger, 0, true)).actions;
            let [Action::ScreenBuoy(_, target, held)] = &actions[..] else {
                panic!("{layer:?}: {actions:?}");
            };
            assert_eq!(target.desktop_target, layer == Layer::Desktops);
            assert!(target.content.is_none());
            assert!(held.contains(&key(&h, 0, true).code));
            if layer == Layer::Desktops {
                assert_eq!(target.desktop_id, "d2");
                assert_eq!(target.pid, 0); // Empty desktop needs no foreground window.
            } else {
                assert_eq!(target.id, if layer == Layer::Tabs { "w0" } else { "w1" });
            }
            assert!(e.handle(key(&trigger, 0, false)).actions.is_empty());
        }
    }
}
#[test]
fn desktop_continuation_preserves_selected_desktop_filter_even_when_empty() {
    let mut e = engine();
    e.open_layer(Layer::Desktops, Mode::Held, false, false, None);
    let target = e
        .session
        .windows
        .iter()
        .find(|w| w.window.desktop_id == "d2")
        .unwrap()
        .window
        .clone();
    e.open_layer(Layer::Windows, Mode::Held, false, true, Some(target));
    assert!(e.session.windows.is_empty());
    assert_eq!(e.session.desktop_filter.as_deref(), Some("d2"));
    let target = Destination {
        desktop_target: true,
        desktop_id: "d1".into(),
        ..Default::default()
    };
    e.open_layer(Layer::Windows, Mode::Held, false, true, Some(target));
    assert_eq!(e.session.windows.len(), 3);
    assert!(e
        .session
        .windows
        .iter()
        .all(|w| w.window.desktop_id == "d1"));
}
#[test]
fn desktop_cycle_without_history_starts_from_current_and_rejects_closed_targets() {
    let mut e = engine();
    e.desktop_mru.clear();
    e.snapshot.desktops[0].current = false;
    e.snapshot.desktops[1].current = true;
    e.open_layer(Layer::Desktops, Mode::Held, false, false, None);
    assert_eq!(e.session.selected.as_deref(), Some("desktop:d2"));
    e.snapshot.desktops.retain(|d| d.id != "d2");
    assert!(!e
        .activate(None)
        .iter()
        .any(|a| matches!(a, Action::Activate(..))));
    assert!(e.session.error.is_some());
}

fn desktop_observed(e: &mut Engine, id: &str) {
    let mut snapshot = e.snapshot.clone();
    for desktop in &mut snapshot.desktops {
        desktop.current = desktop.id == id;
    }
    e.update(snapshot);
}

#[test]
fn desktop_shortcut_toggles_last_two_confirmed_desktops_without_reordering_hints() {
    let mut e = engine();
    let mut original_hints = None;
    for target in ["d1", "d0", "d1", "d0"] {
        let response = e.handle(key("Tab", CTRL | SUPER, true));
        assert!(response.consumed);
        assert_eq!(e.session.selected, Some(format!("desktop:{target}")));
        let hints: Vec<_> = e
            .session
            .windows
            .iter()
            .map(|w| (w.window.id.clone(), w.hint.clone()))
            .collect();
        assert_eq!(
            hints.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            ["desktop:d0", "desktop:d1", "desktop:d2"]
        );
        if let Some(previous) = &original_hints {
            assert_eq!(&hints, previous);
        }
        original_hints = Some(hints);
        e.handle(key("Tab", CTRL | SUPER, false));
        e.handle(key("Control", SUPER, false));
        let response = e.handle(key("Super", 0, false));
        assert!(
            matches!(&response.actions[..], [Action::Activate(_, d)] if d.desktop_id == target)
        );
        desktop_observed(&mut e, target);
        // Inventory refreshes must neither lose nor reorder desktop history.
        e.update(e.snapshot.clone());
        e.update(e.snapshot.clone());
        assert!(!e.mru.iter().any(|id| id.starts_with("desktop:")));
    }
}

#[test]
fn desktop_history_tracks_external_switches_and_excludes_failed_or_closed_targets() {
    let mut e = engine();
    desktop_observed(&mut e, "d2"); // Mission Control / OS shortcut.
    desktop_observed(&mut e, "d1");
    e.open_layer(Layer::Desktops, Mode::Held, false, false, None);
    assert_eq!(e.session.selected.as_deref(), Some("desktop:d2"));
    e.activate(Some("desktop:d0")); // Requested, but native activation fails.
    e.update(e.snapshot.clone());
    e.open_layer(Layer::Desktops, Mode::Held, false, false, None);
    assert_eq!(e.session.selected.as_deref(), Some("desktop:d2"));
    e.dismiss();
    let mut snapshot = e.snapshot.clone();
    snapshot.desktops.retain(|d| d.id != "d2");
    e.update(snapshot);
    e.open_layer(Layer::Desktops, Mode::Held, false, false, None);
    assert_eq!(e.session.selected.as_deref(), Some("desktop:d0"));
}

#[test]
fn desktop_reverse_and_further_tabs_follow_stable_overview_order() {
    let mut e = engine();
    desktop_observed(&mut e, "d2");
    desktop_observed(&mut e, "d1");
    e.open_layer(Layer::Desktops, Mode::Held, false, false, None);
    assert_eq!(e.session.selected.as_deref(), Some("desktop:d2"));
    e.navigate(1);
    assert_eq!(e.session.selected.as_deref(), Some("desktop:d0"));
    e.open_layer(Layer::Desktops, Mode::Held, true, false, None);
    assert_eq!(e.session.selected.as_deref(), Some("desktop:d0"));
    // Shared Space's activation anchor differs from the focused external display.
    e.snapshot.windows[0].display_id = "external".into();
    e.snapshot.desktops[1].display_ids = vec!["screen".into(), "external".into()];
    e.open_layer(Layer::Desktops, Mode::Held, true, false, None);
    assert_eq!(e.session.selected.as_deref(), Some("desktop:d0"));
}
#[test]
fn cancelled_generation_and_closed_native_parent_cannot_activate_plugin_targets() {
    let mut e = engine();
    e.open_layer(Layer::Tabs, Mode::Held, false, false, None);
    let old = e.session.session_id;
    let items = tabs(&e);
    e.open(Mode::Search, false);
    assert!(e.tabs_loaded(old, Ok(items)).is_empty());
    e.open_layer(Layer::Tabs, Mode::Search, false, false, None);
    let items = tabs(&e);
    e.tabs_loaded(e.session.session_id, Ok(items));
    e.search("example.test/2".into());
    assert_eq!(e.session.selected.as_deref(), Some("tab2"));
    e.snapshot.windows.retain(|w| w.id != "w0");
    assert!(!e
        .activate(None)
        .iter()
        .any(|a| matches!(a, Action::Activate(..))));
}
#[test]
fn configurable_physical_continuation_keys_do_not_fire_without_held_hint() {
    let mut e = engine();
    e.config.tabs_hint_keys = vec!["HintLeftKey".into()];
    assert!(!e.handle(key("S", 0, true)).consumed);
    e.handle(key("Tab", SUPER, true));
    e.handle(key("Tab", SUPER, false));
    let h = hint(&mut e, "w1", SUPER);
    let trigger = e.config.screen_buoy.neighbours[&h].left.clone().unwrap();
    assert!(matches!(
        &e.handle(key(&trigger, SUPER, true)).actions[..],
        [Action::Continue(_, _, Layer::Tabs)]
    ));
    for name in [&h, &trigger, "Super"] {
        assert!(e.handle(key(name, 0, false)).actions.is_empty());
    }
}

#[test]
fn changing_focus_dismisses_loading_and_sticky_layers_without_stealing_focus_back() {
    for layer in [Layer::Windows, Layer::Tabs] {
        let mut e = engine();
        e.open_layer(layer, Mode::Held, false, true, None);
        let actions = e.observe_native_focus(Some("w4".into()));
        assert!(matches!(&actions[..], [Action::Cancel(_, None)]));
        assert_eq!(e.session.mode, Mode::Inactive);
        assert!(!e.session.loading);
        assert_eq!(e.snapshot.focused_id.as_deref(), Some("w4"));
        assert!(e.tabs_loaded(e.session.session_id, Ok(vec![])).is_empty());
        assert!(!e.handle(key("Escape", 0, true)).consumed);
    }
    let mut e = engine();
    e.open_layer(Layer::Windows, Mode::Search, false, false, None);
    assert!(e.observe_native_focus(None).is_empty()); // The search panel owns focus.
    assert_eq!(e.session.mode, Mode::Search);
}

#[test]
fn desktop_continuation_uses_target_monitor_when_no_window_has_focus() {
    let mut e = engine();
    e.config.display_scope = crate::config::Scope::Current;
    e.snapshot.focused_id = None;
    e.snapshot.windows[3].display_id = "other-monitor".into();
    let desktop = Destination {
        desktop_target: true,
        desktop_id: "d1".into(),
        display_id: "other-monitor".into(),
        ..Default::default()
    };
    e.open_layer(Layer::Windows, Mode::Held, false, true, Some(desktop));
    assert_eq!(e.session.windows.len(), 1);
    assert_eq!(e.session.windows[0].window.id, "w3");
}

#[test]
fn file_search_ignores_late_results_and_blocks_activation_until_current_results_arrive() {
    let mut e = engine();
    e.open_layer(Layer::Tabs, Mode::Search, false, false, None);
    let sid = e.session.session_id;
    e.tabs_loaded(sid, Ok(vec![]));
    e.content_search = Some(crate::plugins::SearchContext {
        endpoint: crate::plugins::Endpoint {
            protocol: 1,
            provider: "test".into(),
            name: None,
            version: None,
            instance: "instance".into(),
            app_ids: vec![],
            port: 1,
            token: "token".into(),
            capabilities: vec!["search".into()],
        },
        context: "context".into(),
        parent: e.session.origin.clone().unwrap(),
    });
    e.search("first".into());
    let (_, first, _, _) = e.content_search_request().unwrap();
    assert!(e.content_search_request().is_none());
    assert!(e.activate(None).is_empty());
    e.search("second".into());
    let (_, second, _, _) = e.content_search_request().unwrap();
    assert!(e
        .content_search_loaded(sid, first, "first", Ok(tabs(&e)))
        .is_empty());
    e.search("first".into());
    let (_, third, _, _) = e.content_search_request().unwrap();
    assert!(e
        .content_search_loaded(sid, first, "first", Ok(tabs(&e)))
        .is_empty());
    assert!(e
        .content_search_loaded(sid, second, "second", Ok(tabs(&e)))
        .is_empty());
    let items = tabs(&e);
    e.content_search_loaded(sid, third, "first", Ok(items));
    // Provider matching is authoritative, including platform path separators.
    assert_eq!(e.results().len(), 3);
    assert!(e.session.selected.is_some());
    e.cancel();
    assert!(e
        .content_search_loaded(sid, third, "first", Ok(vec![]))
        .is_empty());
}
