use crate::model::*;
use std::{cell::Cell, ffi::c_void, mem::size_of, thread, time::Duration};
use windows::{
    core::{BOOL, GUID, PWSTR},
    Win32::{
        Foundation::*,
        Graphics::{Dwm::*, Gdi::*},
        System::{Com::*, Threading::*},
        UI::{HiDpi::*, Shell::*, WindowsAndMessaging::*},
    },
};
thread_local! {static COM:Cell<bool>=const{Cell::new(false)};}
fn init_com() {
    COM.with(|c| {
        if !c.replace(true) {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
        }
    });
}
fn desktop_manager() -> Option<IVirtualDesktopManager> {
    init_com();
    unsafe {
        CoCreateInstance(
            &GUID::from_u128(0xaa509086_5ca9_4c25_8f95_589d3c07b48a),
            None,
            CLSCTX_ALL,
        )
        .ok()
    }
}
fn id(hwnd: HWND, pid: u32) -> String {
    format!("win:{pid}:{}", hwnd.0 as usize)
}
unsafe fn title(hwnd: HWND) -> String {
    let len = GetWindowTextLengthW(hwnd);
    let mut text = vec![0u16; (len + 1).max(1) as usize];
    let n = GetWindowTextW(hwnd, &mut text);
    String::from_utf16_lossy(&text[..n.max(0) as usize])
}
unsafe fn app_path(pid: u32) -> String {
    let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
        return String::new();
    };
    let mut buffer = vec![0u16; 32768];
    let mut size = buffer.len() as u32;
    let result = QueryFullProcessImageNameW(
        process,
        PROCESS_NAME_WIN32,
        PWSTR(buffer.as_mut_ptr()),
        &mut size,
    );
    let _ = CloseHandle(process);
    if result.is_ok() {
        String::from_utf16_lossy(&buffer[..size as usize])
    } else {
        String::new()
    }
}
thread_local! { static ICONS: std::cell::RefCell<std::collections::HashMap<u32, Option<String>>> = std::cell::RefCell::new(std::collections::HashMap::new()); }
unsafe fn app_icon(hwnd: HWND, pid: u32) -> Option<String> {
    ICONS.with(|cache| {
        let mut cache = cache.borrow_mut();
        if let Some(icon) = cache.get(&pid) {
            return icon.clone();
        }
        let icon = capture_icon(hwnd);
        if cache.len() >= 256 {
            cache.clear();
        }
        cache.insert(pid, icon.clone());
        icon
    })
}
unsafe fn capture_icon(hwnd: HWND) -> Option<String> {
    let mut handle = 0usize;
    let _ = SendMessageTimeoutW(
        hwnd,
        WM_GETICON,
        WPARAM(ICON_SMALL2 as usize),
        LPARAM(0),
        SMTO_ABORTIFHUNG,
        30,
        Some(&mut handle),
    );
    if handle == 0 {
        handle = GetClassLongPtrW(hwnd, GCLP_HICONSM);
    }
    if handle == 0 {
        handle = GetClassLongPtrW(hwnd, GCLP_HICON);
    }
    if handle == 0 {
        return None;
    }
    let dc = CreateCompatibleDC(None);
    if dc.is_invalid() {
        return None;
    }
    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: 32,
        biHeight: -32,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let mut bits = std::ptr::null_mut();
    let Ok(bitmap) = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) else {
        let _ = DeleteDC(dc);
        return None;
    };
    let previous = SelectObject(dc, bitmap.into());
    std::ptr::write_bytes(bits as *mut u8, 0, 32 * 32 * 4);
    let drawn = DrawIconEx(
        dc,
        0,
        0,
        HICON(handle as *mut c_void),
        32,
        32,
        0,
        None,
        DI_NORMAL,
    );
    let mut pixels = std::slice::from_raw_parts(bits as *const u8, 32 * 32 * 4).to_vec();
    SelectObject(dc, previous);
    let _ = DeleteObject(bitmap.into());
    let _ = DeleteDC(dc);
    if drawn.is_err() {
        return None;
    }
    let has_alpha = pixels.chunks_exact(4).any(|p| p[3] != 0);
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        if !has_alpha {
            pixel[3] = if pixel[..3].iter().any(|c| *c != 0) {
                255
            } else {
                0
            };
        }
    }
    let mut data = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut data, 32, 32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .ok()?
            .write_image_data(&pixels)
            .ok()?;
    }
    use base64::Engine;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(data)
    ))
}
unsafe fn display(monitor: HMONITOR) -> Option<Display> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    if !GetMonitorInfoW(monitor, &mut info as *mut _ as *mut MONITORINFO).as_bool() {
        return None;
    }
    let r = info.monitorInfo.rcMonitor;
    let name = String::from_utf16_lossy(
        &info.szDevice[..info
            .szDevice
            .iter()
            .position(|x| *x == 0)
            .unwrap_or(info.szDevice.len())],
    );
    let mut dpi_x = 96;
    let mut dpi_y = 96;
    let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
    Some(Display {
        id: format!("{}", monitor.0 as usize),
        name,
        bounds: Bounds {
            x: r.left as f64,
            y: r.top as f64,
            width: (r.right - r.left) as f64,
            height: (r.bottom - r.top) as f64,
        },
        scale: dpi_x as f64 / 96.,
    })
}
unsafe extern "system" fn monitor_callback(
    monitor: HMONITOR,
    _: HDC,
    _: *mut RECT,
    param: LPARAM,
) -> BOOL {
    if let Some(d) = display(monitor) {
        (*(param.0 as *mut Vec<Display>)).push(d);
    }
    true.into()
}
struct Inventory {
    windows: Vec<Destination>,
    manager: Option<IVirtualDesktopManager>,
}
unsafe extern "system" fn window_callback(hwnd: HWND, param: LPARAM) -> BOOL {
    let inventory = &mut *(param.0 as *mut Inventory);
    if !IsWindowVisible(hwnd).as_bool() {
        return true.into();
    }
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 || pid == std::process::id() {
        return true.into();
    }
    let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
    if style & WS_EX_TOOLWINDOW.0 != 0 || style & WS_EX_NOACTIVATE.0 != 0 {
        return true.into();
    }
    if GetWindow(hwnd, GW_OWNER)
        .map(|h| !h.is_invalid())
        .unwrap_or(false)
        && style & WS_EX_APPWINDOW.0 == 0
    {
        return true.into();
    }
    let name = title(hwnd);
    if name.trim().is_empty() {
        return true.into();
    }
    let mut r = RECT::default();
    if GetWindowRect(hwnd, &mut r).is_err() {
        return true.into();
    }
    let minimized = IsIconic(hwnd).as_bool();
    if minimized {
        let mut place = WINDOWPLACEMENT {
            length: size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        if GetWindowPlacement(hwnd, &mut place).is_ok() {
            r = place.rcNormalPosition;
        }
    }
    if r.right - r.left < 50 || r.bottom - r.top < 30 {
        return true.into();
    }
    let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    let current = inventory
        .manager
        .as_ref()
        .and_then(|m| m.IsWindowOnCurrentVirtualDesktop(hwnd).ok())
        .map(|b| b.as_bool());
    let desktop = inventory
        .manager
        .as_ref()
        .and_then(|m| m.GetWindowDesktopId(hwnd).ok())
        .map(|g| format!("{g:?}"))
        .unwrap_or_default();
    let mut cloaked = 0u32;
    let _ = DwmGetWindowAttribute(
        hwnd,
        DWMWA_CLOAKED,
        &mut cloaked as *mut _ as *mut c_void,
        size_of::<u32>() as u32,
    );
    // DWM_CLOAKED_SHELL is also how Windows represents windows on another desktop.
    if cloaked != 0 && current != Some(false) {
        return true.into();
    }
    let path = app_path(pid);
    let app_name = std::path::Path::new(&path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Application".into());
    inventory.windows.push(Destination {
        id: id(hwnd, pid),
        native_id: hwnd.0 as u64,
        pid,
        title: name,
        app_name,
        app_id: path,
        display_id: format!("{}", monitor.0 as usize),
        desktop_id: desktop,
        desktop_name: if current == Some(true) {
            "Current desktop".into()
        } else {
            "Other desktop".into()
        },
        current_desktop: current,
        minimized,
        hidden: false,
        bounds: Bounds {
            x: r.left as f64,
            y: r.top as f64,
            width: (r.right - r.left) as f64,
            height: (r.bottom - r.top) as f64,
        },
        icon: app_icon(hwnd, pid),
    });
    true.into()
}
pub fn focused_id() -> Option<String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        (pid != 0 && pid != std::process::id()).then(|| id(hwnd, pid))
    }
}
pub fn snapshot() -> Result<Snapshot, String> {
    unsafe {
        let mut inventory = Inventory {
            windows: vec![],
            manager: desktop_manager(),
        };
        let mut displays = vec![];
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(monitor_callback),
            LPARAM(&mut displays as *mut _ as isize),
        );
        EnumWindows(
            Some(window_callback),
            LPARAM(&mut inventory as *mut _ as isize),
        )
        .map_err(|e| e.to_string())?;
        let front = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(front, Some(&mut pid));
        let mut warnings = vec![];
        if inventory.manager.is_none() {
            warnings.push("Windows desktop membership is unavailable. Current-desktop filtering excludes unverified windows.".into());
        }
        Ok(Snapshot {
            windows: inventory.windows,
            displays,
            current_display: format!(
                "{}",
                MonitorFromWindow(front, MONITOR_DEFAULTTONEAREST).0 as usize
            ),
            focused_id: Some(id(front, pid)),
            warnings,
        })
    }
}
pub fn activate(w: &Destination) -> Result<(), String> {
    unsafe {
        let hwnd = HWND(w.native_id as *mut c_void);
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if !IsWindow(Some(hwnd)).as_bool() || pid != w.pid {
            return Err("The selected window has closed.".into());
        }
        if let Some(manager) = desktop_manager() {
            if manager
                .IsWindowOnCurrentVirtualDesktop(hwnd)
                .map(|b| !b.as_bool())
                .unwrap_or(false)
            {
                let desktop =
                    winvd::get_desktop_by_window(windows58::Win32::Foundation::HWND(hwnd.0))
                        .map_err(|e| {
                            format!(
                                "Desktop switching is unavailable on this Windows version: {e:?}"
                            )
                        })?;
                winvd::switch_desktop(desktop)
                    .map_err(|e| format!("Windows could not switch to that desktop: {e:?}"))?;
                for _ in 0..30 {
                    if manager
                        .IsWindowOnCurrentVirtualDesktop(hwnd)
                        .map(|b| b.as_bool())
                        .unwrap_or(false)
                    {
                        break;
                    }
                    thread::sleep(Duration::from_millis(30));
                }
            }
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindowAsync(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
        for attempt in 0..25 {
            if GetForegroundWindow() == hwnd {
                return Ok(());
            }
            if attempt == 3 {
                let current = GetCurrentThreadId();
                let foreground = GetWindowThreadProcessId(GetForegroundWindow(), None);
                let attached = foreground != 0
                    && foreground != current
                    && AttachThreadInput(current, foreground, true).as_bool();
                let _ = BringWindowToTop(hwnd);
                let _ = SetForegroundWindow(hwnd);
                if attached {
                    let _ = AttachThreadInput(current, foreground, false);
                }
            }
            thread::sleep(Duration::from_millis(30));
        }
        Err("Windows did not give focus to the selected window. Elevated applications may require the same privilege level.".into())
    }
}
// Bounded WM_PRINT capture: an unresponsive application must not hang the switcher.
// Applications that don't support printing keep their title/icon placeholder.
pub fn thumbnails(windows: &[Destination]) -> HashMap<String, String> {
    windows
        .iter()
        .filter_map(|w| thumbnail(w).map(|image| (w.id.clone(), image)))
        .collect()
}
pub fn thumbnail(w: &Destination) -> Option<String> {
    unsafe {
        let hwnd = HWND(w.native_id as *mut c_void);
        let width = w.bounds.width.min(1920.) as i32;
        let height = w.bounds.height.min(1200.) as i32;
        if width <= 0 || height <= 0 {
            return None;
        }
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous = SelectObject(dc, bitmap.into());
        let flags = PRF_CLIENT | PRF_NONCLIENT | PRF_CHILDREN | PRF_ERASEBKGND;
        let mut result = 0usize;
        let printed = SendMessageTimeoutW(
            hwnd,
            WM_PRINT,
            WPARAM(dc.0 as usize),
            LPARAM(flags as isize),
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            180,
            Some(&mut result),
        );
        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = width;
        info.bmiHeader.biHeight = -height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB.0;
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        SelectObject(dc, previous);
        let lines = if printed.0 != 0 {
            GetDIBits(
                dc,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as *mut c_void),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);
        if lines == 0
            || !pixels
                .chunks_exact(4)
                .any(|p| p[0] != 0 || p[1] != 0 || p[2] != 0)
        {
            return None;
        }
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        let mut data = vec![];
        {
            let mut encoder = png::Encoder::new(&mut data, width as u32, height as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .ok()?
                .write_image_data(&pixels)
                .ok()?;
        }
        use base64::Engine;
        Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(data)
        ))
    }
}
pub fn permissions() -> PermissionStatus {
    PermissionStatus {
        required: false,
        accessibility: true,
        input_monitoring: true,
        screen_recording: true,
        keyboard_hook: crate::input::is_ready(),
        ready: crate::input::is_ready(),
        app_path: std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }
}
pub fn request_permission(_: &str) -> Result<(), String> {
    Ok(())
}
pub fn show_panel(window: &tauri::WebviewWindow, search: bool) {
    if search {
        let _ = window.show();
        let _ = window.set_focus();
    } else if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = ShowWindow(HWND(hwnd.0), SW_SHOWNOACTIVATE);
        }
    }
}

use once_cell::sync::Lazy;
use std::{collections::HashMap, sync::Mutex};
static LIVE_PREVIEWS: Lazy<Mutex<HashMap<String, isize>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
pub fn clear_previews() {
    let mut previews = LIVE_PREVIEWS.lock().unwrap();
    for (_, handle) in previews.drain() {
        unsafe {
            let _ = DwmUnregisterThumbnail(handle);
        }
    }
}
pub fn live_preview(
    panel: &tauri::WebviewWindow,
    key: &str,
    target: &Destination,
    bounds: Option<Bounds>,
    hint: Option<Bounds>,
) -> bool {
    let mut previews = LIVE_PREVIEWS.lock().unwrap();
    let Some(b) = bounds else {
        for slot in 0..4 {
            if let Some(handle) = previews.remove(&format!("{key}:{slot}")) {
                unsafe {
                    let _ = DwmUnregisterThumbnail(handle);
                }
            }
        }
        return false;
    };
    let Ok(destination) = panel.hwnd() else {
        return false;
    };
    let source = HWND(target.native_id as *mut c_void);
    let mut updated = false;
    unsafe {
        // DWM thumbnails composite above the WebView. Leave a center hole for
        // the HTML hint instead of letting the native preview cover its badge.
        for slot in 0..4 {
            let slot_key = format!("{key}:{slot}");
            let handle = if let Some(handle) = previews.get(&slot_key) {
                *handle
            } else {
                let Ok(handle) = DwmRegisterThumbnail(HWND(destination.0), source) else {
                    continue;
                };
                previews.insert(slot_key.clone(), handle);
                handle
            };
            let Ok(size) = DwmQueryThumbnailSourceSize(handle) else {
                continue;
            };
            let scale = (b.width / size.cx.max(1) as f64).min(b.height / size.cy.max(1) as f64);
            if scale <= 0. {
                continue;
            }
            let width = size.cx as f64 * scale;
            let height = size.cy as f64 * scale;
            let fitted = Bounds {
                x: b.x + (b.width - width) / 2.,
                y: b.y + (b.height - height) / 2.,
                width,
                height,
            };
            let pieces = crate::panel::around_hint(&fitted, hint.as_ref());
            let Some(piece) = pieces.get(slot) else {
                if let Some(handle) = previews.remove(&slot_key) {
                    let _ = DwmUnregisterThumbnail(handle);
                }
                continue;
            };
            let properties = DWM_THUMBNAIL_PROPERTIES {
                dwFlags: DWM_TNP_RECTDESTINATION
                    | DWM_TNP_RECTSOURCE
                    | DWM_TNP_VISIBLE
                    | DWM_TNP_OPACITY
                    | DWM_TNP_SOURCECLIENTAREAONLY,
                rcDestination: RECT {
                    left: piece.x.round() as i32,
                    top: piece.y.round() as i32,
                    right: (piece.x + piece.width).round() as i32,
                    bottom: (piece.y + piece.height).round() as i32,
                },
                rcSource: RECT {
                    left: ((piece.x - fitted.x) / scale).round() as i32,
                    top: ((piece.y - fitted.y) / scale).round() as i32,
                    right: ((piece.x + piece.width - fitted.x) / scale).round() as i32,
                    bottom: ((piece.y + piece.height - fitted.y) / scale).round() as i32,
                },
                opacity: 255,
                fVisible: true.into(),
                fSourceClientAreaOnly: false.into(),
            };
            updated |= DwmUpdateThumbnailProperties(handle, &properties).is_ok();
        }
    }
    updated
}
