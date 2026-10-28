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
};
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
            let search = MenuItem::with_id(app, "search", "Search windows", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit BeaconHop", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&search, &settings, &quit])?;
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
                    "search" => {
                        runtime::open_search_inner();
                    }
                    "settings" => runtime::show_settings(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
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
