use crate::{config::*, engine::KeyEvent, runtime};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::{cell::RefCell, collections::HashSet};
use windows::Win32::{
    Foundation::*,
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};
thread_local! {static PRESSED:RefCell<HashSet<u32>>=RefCell::new(HashSet::new());}
const MENU_MASK: usize = 0x42484f50;
static READY: AtomicBool = AtomicBool::new(false);
static THREAD: AtomicU32 = AtomicU32::new(0);
pub fn is_ready() -> bool {
    READY.load(Ordering::Acquire)
}
fn name(code: u32) -> String {
    match code {
        65..=90 | 48..=57 => char::from_u32(code).unwrap().to_string(),
        9 => "Tab".into(),
        13 => "Enter".into(),
        27 => "Escape".into(),
        32 => "Space".into(),
        192 => "Backquote".into(),
        220 => "Backslash".into(),
        8 => "Backspace".into(),
        37 => "ArrowLeft".into(),
        38 => "ArrowUp".into(),
        39 => "ArrowRight".into(),
        40 => "ArrowDown".into(),
        18 | 164 | 165 => "Alt".into(),
        17 | 162 | 163 => "Control".into(),
        91 | 92 => "Super".into(),
        16 | 160 | 161 => "Shift".into(),
        _ => "Unknown".into(),
    }
}
unsafe extern "system" fn callback(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code >= 0 {
        let message = w.0 as u32;
        if matches!(message, WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP) {
            let event = &*(l.0 as *const KBDLLHOOKSTRUCT);
            if event.dwExtraInfo == MENU_MASK {
                return CallNextHookEx(None, code, w, l);
            }
            let down = matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN);
            let key = name(event.vkCode);
            let repeat = PRESSED.with(|p| {
                let mut p = p.borrow_mut();
                if down {
                    !p.insert(event.vkCode)
                } else {
                    p.remove(&event.vkCode);
                    false
                }
            });
            let mut modifiers = 0;
            for (left, right, bit) in [
                (VK_LMENU, VK_RMENU, ALT),
                (VK_LCONTROL, VK_RCONTROL, CTRL),
                (VK_LWIN, VK_RWIN, SUPER),
                (VK_LSHIFT, VK_RSHIFT, SHIFT),
            ] {
                let state = |vk: VIRTUAL_KEY| {
                    if event.vkCode == vk.0 as u32 {
                        down
                    } else {
                        GetAsyncKeyState(vk.0 as i32) < 0
                    }
                };
                if state(left) || state(right) {
                    modifiers |= bit;
                }
            }
            if runtime::key(KeyEvent {
                key,
                code: event.vkCode,
                modifiers,
                down,
                repeat,
            }) {
                // Mask the lone Alt/Windows menu action after a swallowed shortcut.
                // VK 0xE8 is unassigned and cannot insert text or release a physical modifier.
                if down && !repeat && modifiers & (ALT | SUPER) != 0 {
                    let inputs = [
                        INPUT {
                            r#type: INPUT_KEYBOARD,
                            Anonymous: INPUT_0 {
                                ki: KEYBDINPUT {
                                    wVk: VIRTUAL_KEY(0xE8),
                                    dwExtraInfo: MENU_MASK,
                                    ..Default::default()
                                },
                            },
                        },
                        INPUT {
                            r#type: INPUT_KEYBOARD,
                            Anonymous: INPUT_0 {
                                ki: KEYBDINPUT {
                                    wVk: VIRTUAL_KEY(0xE8),
                                    dwFlags: KEYEVENTF_KEYUP,
                                    dwExtraInfo: MENU_MASK,
                                    ..Default::default()
                                },
                            },
                        },
                    ];
                    SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
                }
                return LRESULT(1);
            }
        }
    }
    CallNextHookEx(None, code, w, l)
}
pub fn init(_: tauri::AppHandle) {
    std::thread::Builder::new()
        .name("keyboard-hook".into())
        .spawn(|| unsafe {
            THREAD.store(
                windows::Win32::System::Threading::GetCurrentThreadId(),
                Ordering::Release,
            );
            let Ok(hook) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(callback), None, 0) else {
                log::error!("Could not install keyboard hook");
                return;
            };
            READY.store(true, Ordering::Release);
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            let _ = UnhookWindowsHookEx(hook);
            READY.store(false, Ordering::Release);
        })
        .expect("keyboard hook thread");
}
pub fn cleanup() {
    let id = THREAD.load(Ordering::Acquire);
    if id != 0 {
        unsafe {
            let _ = PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}
