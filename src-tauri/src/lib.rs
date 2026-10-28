mod codes;
mod config;
mod engine;
mod input;
mod logger;
#[cfg(target_os = "macos")]
mod macos_access;
mod model;
mod platform;
mod runtime;
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
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            runtime::show_settings(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            runtime::record_shortcut,
            runtime::restart_application,
            runtime::set_live_preview,
            runtime::get_settings,
            runtime::save_settings,
            runtime::get_session,
            runtime::open_search,
            runtime::search,
            runtime::navigate,
            runtime::activate,
            runtime::cancel,
            runtime::get_thumbnail,
            runtime::get_permissions,
            runtime::request_permission,
            runtime::get_diagnostics
        ])
        .setup(|app| {
            runtime::init(app.handle().clone())?;
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
                    "restart" => app.request_restart(),
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
    app.run(|_, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            input::cleanup();
        }
    });
}
