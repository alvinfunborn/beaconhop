mod codes;
mod config;
mod engine;
mod input;
mod logger;
#[cfg(target_os = "macos")]
mod macos_access;
mod model;
mod navigation;
mod panel;
mod platform;
mod runtime;
mod search;
mod stable_hints;
mod updates;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

struct TrayMenuLabels([MenuItem<tauri::Wry>; 3]);

fn tray_labels(language: &str) -> [&'static str; 3] {
    let zh = language == "zh"
        || (language == "system"
            && sys_locale::get_locale().is_some_and(|locale| locale.starts_with("zh")));
    if zh {
        ["打开设置", "重启", "退出"]
    } else {
        ["Open Settings", "Restart", "Quit"]
    }
}

pub(crate) fn update_tray_language(app: &tauri::AppHandle, language: &str) {
    if let Some(menu) = app.try_state::<TrayMenuLabels>() {
        for (item, label) in menu.0.iter().zip(tray_labels(language)) {
            if let Err(error) = item.set_text(label) {
                log::warn!("Could not update tray label: {error}");
            }
        }
    }
}

pub fn run() {
    let _ = logger::init_logger("info".into());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            runtime::show_settings(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            updates::get_release_status,
            updates::open_releases_page,
            runtime::record_shortcut,
            runtime::restart_application,
            runtime::set_live_preview,
            runtime::get_settings,
            runtime::save_settings,
            runtime::get_session,
            runtime::open_search,
            runtime::search,
            runtime::navigate,
            runtime::navigate_direction,
            runtime::set_navigation,
            runtime::activate,
            runtime::cancel,
            runtime::get_thumbnails,
            runtime::get_cached_thumbnails,
            runtime::get_permissions,
            runtime::request_permission,
            runtime::get_diagnostics
        ])
        .setup(|app| {
            runtime::init(app.handle().clone())?;
            for label in ["switcher"] {
                if let Some(panel) = app.get_webview_window(label) {
                    use tauri::window::{Effect, EffectsBuilder};
                    #[cfg(target_os = "macos")]
                    let effects = EffectsBuilder::new()
                        .effect(Effect::Sidebar)
                        .state(tauri::window::EffectState::Active)
                        .radius(17.)
                        .build();
                    #[cfg(target_os = "windows")]
                    let effects = EffectsBuilder::new()
                        .effect(Effect::Acrylic)
                        .color(tauri::window::Color(22, 23, 33, 70))
                        .build();
                    if let Err(error) = panel.set_effects(effects) {
                        log::warn!("Panel backdrop unavailable: {error}");
                    }
                }
            }
            let [settings_label, restart_label, quit_label] =
                tray_labels(&runtime::get_settings().language);
            let settings = MenuItem::with_id(app, "settings", settings_label, true, None::<&str>)?;
            let restart = MenuItem::with_id(app, "restart", restart_label, true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings, &restart, &quit])?;
            #[cfg(target_os = "macos")]
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray_icon.png"))?;
            #[cfg(not(target_os = "macos"))]
            let tray_icon = app.default_window_icon().unwrap().clone();
            TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("BeaconHop")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => runtime::show_settings(app),
                    "restart" => {
                        if let Err(error) = runtime::restart_application() {
                            log::error!("{error}");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            app.manage(TrayMenuLabels([settings, restart, quit]));
            input::init(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label() == "switcher" {
                    runtime::cancel_inner();
                } else {
                    let _ = window.hide();
                }
            }
            if window.label() == "switcher" && matches!(event, tauri::WindowEvent::Focused(false)) {
                runtime::lost_focus();
            }
        })
        .build(tauri::generate_context!())
        .expect("Could not start BeaconHop");
    app.run(|_app, event| match event {
        // Launch Services reopens the running macOS app without starting a
        // second process, so the single-instance callback does not run.
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => runtime::show_settings(_app),
        tauri::RunEvent::Exit => input::cleanup(),
        _ => {}
    });
}
