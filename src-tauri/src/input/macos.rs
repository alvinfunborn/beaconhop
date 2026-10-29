use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::Mutex;

use core_foundation::base::TCFType;
use core_foundation::mach_port::CFMachPort;
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::EventField;
use log::{error, info, warn};
use once_cell::sync::Lazy;

use crate::config;
use crate::{engine::KeyEvent, runtime};

type CGEventRef = *const c_void;
type CGEventTapProxy = *const c_void;

type CGEventTapCallBackInternal = unsafe extern "C" fn(
    proxy: CGEventTapProxy,
    etype: u32,
    event: CGEventRef,
    user_info: *const c_void,
) -> CGEventRef;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: CGEventTapCallBackInternal,
        user_info: *const c_void,
    ) -> core_foundation::mach_port::CFMachPortRef;

    fn CGEventTapEnable(tap: core_foundation::mach_port::CFMachPortRef, enable: bool);
    fn CGEventTapIsEnabled(tap: core_foundation::mach_port::CFMachPortRef) -> bool;
    fn CGEventGetFlags(event: CGEventRef) -> u64;
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRunLoopRun();
    fn CFRunLoopStop(rl: *const c_void);
}

static TAP_RUNLOOP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static RUNNING: AtomicBool = AtomicBool::new(false);
static READY: AtomicBool = AtomicBool::new(false);

pub fn is_ready() -> bool {
    READY.load(Ordering::Acquire)
}

const CG_KEY_DOWN: u32 = 10;
const CG_KEY_UP: u32 = 11;
const CG_FLAGS_CHANGED: u32 = 12;
const CG_TAP_DISABLED_TIMEOUT: u32 = 0xFFFF_FFFE;
const CG_TAP_DISABLED_USER: u32 = 0xFFFF_FFFF;

static APP_HANDLE: Lazy<Mutex<Option<tauri::AppHandle>>> = Lazy::new(|| Mutex::new(None));

thread_local! {
    static TAP_STATE: RefCell<Option<TapState>> = RefCell::new(None);
}

struct TapState {
    mach_port: CFMachPort,
    _loop_source: core_foundation::runloop::CFRunLoopSource,
}

fn keycode_to_name(code: u16) -> String {
    let name = match code {
        0 => "A",
        1 => "S",
        2 => "D",
        3 => "F",
        4 => "H",
        5 => "G",
        6 => "Z",
        7 => "X",
        8 => "C",
        9 => "V",
        11 => "B",
        12 => "Q",
        13 => "W",
        14 => "E",
        15 => "R",
        16 => "Y",
        17 => "T",
        18 => "1",
        19 => "2",
        20 => "3",
        21 => "4",
        22 => "6",
        23 => "5",
        24 => "=",
        25 => "9",
        27 => "-",
        30 => "]",
        33 => "[",
        39 => "'",
        41 => ";",
        43 => ",",
        44 => "/",
        47 => ".",
        26 => "7",
        28 => "8",
        29 => "0",
        31 => "O",
        32 => "U",
        34 => "I",
        35 => "P",
        36 => "Enter",
        37 => "L",
        38 => "J",
        40 => "K",
        42 => "Backslash",
        45 => "N",
        46 => "M",
        48 => "Tab",
        49 => "Space",
        // ISO keyboards place the grave-accent key at virtual keycode 10.
        10 | 50 => "Backquote",
        51 => "Backspace",
        53 => "Escape",
        54 | 55 => "Super",
        56 | 60 => "Shift",
        58 | 61 => "Alt",
        59 | 62 => "Control",
        123 => "ArrowLeft",
        124 => "ArrowRight",
        125 => "ArrowDown",
        126 => "ArrowUp",
        _ => "Unknown",
    };
    name.into()
}

// Decode the event being handled. Querying session key state inside the tap
// can still report the previous state, especially for remapped/synthetic keys.
fn modifier_down_from_flags(keycode: u16, flags: u64) -> Option<bool> {
    let (generic, left, right, own) = match keycode {
        56 => (0x20000, 0x2, 0x4, 0x2),
        60 => (0x20000, 0x2, 0x4, 0x4),
        59 => (0x40000, 0x1, 0x2000, 0x1),
        62 => (0x40000, 0x1, 0x2000, 0x2000),
        58 => (0x80000, 0x20, 0x40, 0x20),
        61 => (0x80000, 0x20, 0x40, 0x40),
        55 => (0x100000, 0x8, 0x10, 0x8),
        54 => (0x100000, 0x8, 0x10, 0x10),
        57 => return Some(flags & 0x10000 != 0),
        _ => return None,
    };
    Some(if flags & (left | right) != 0 {
        flags & own != 0
    } else {
        flags & generic != 0
    })
}

unsafe extern "C" fn tap_callback(
    _proxy: CGEventTapProxy,
    etype: u32,
    event_ref: CGEventRef,
    _user_info: *const c_void,
) -> CGEventRef {
    match etype {
        CG_TAP_DISABLED_TIMEOUT | CG_TAP_DISABLED_USER => {
            READY.store(false, Ordering::Release);
            TAP_STATE.with(|c| {
                if let Some(state) = c.borrow().as_ref() {
                    CGEventTapEnable(state.mach_port.as_concrete_TypeRef(), true);
                    READY.store(
                        CGEventTapIsEnabled(state.mach_port.as_concrete_TypeRef()),
                        Ordering::Release,
                    );
                    warn!("[mac tap] re-enabled after disable (etype={})", etype);
                }
            });
            return event_ref;
        }
        _ => {}
    }
    if event_ref.is_null() {
        return event_ref;
    }

    let code = CGEventGetIntegerValueField(event_ref, EventField::KEYBOARD_EVENT_KEYCODE) as u16;
    let flags = CGEventGetFlags(event_ref);
    let down = match etype {
        CG_KEY_DOWN => true,
        CG_KEY_UP => false,
        CG_FLAGS_CHANGED => modifier_down_from_flags(code, flags).unwrap_or(false),
        _ => return event_ref,
    };
    let modifiers = (if flags & 0x80000 != 0 { config::ALT } else { 0 })
        | (if flags & 0x40000 != 0 {
            config::CTRL
        } else {
            0
        })
        | (if flags & 0x100000 != 0 {
            config::SUPER
        } else {
            0
        })
        | (if flags & 0x20000 != 0 {
            config::SHIFT
        } else {
            0
        });
    let event = KeyEvent {
        key: keycode_to_name(code),
        code: code as u32,
        down,
        modifiers,
        repeat: etype == CG_KEY_DOWN
            && CGEventGetIntegerValueField(event_ref, EventField::KEYBOARD_EVENT_AUTOREPEAT) != 0,
    };
    if runtime::key(event) {
        return std::ptr::null();
    }

    event_ref
}

pub fn init(app_handle: tauri::AppHandle) {
    if RUNNING.swap(true, Ordering::AcqRel) {
        return;
    }
    *APP_HANDLE.lock().unwrap() = Some(app_handle);

    if let Ok(p) = std::env::current_exe() {
        info!("[mac tap] installing for executable: {}", p.display());
    }

    std::thread::Builder::new()
        .name("keyboard-tap".into())
        .spawn(|| {
            let mask =
                (1u64 << CG_KEY_DOWN) | (1u64 << CG_KEY_UP) | (1u64 << CG_FLAGS_CHANGED)
               ;

            let port_ref;
            let mut recovery_shown = false;
            loop {
                if !RUNNING.load(Ordering::Acquire) {
                    return;
                }
                let p = unsafe {
                    CGEventTapCreate(0, 0, 0, mask, tap_callback, std::ptr::null())
                };
                if !p.is_null() {
                    port_ref = p;
                    break;
                }
                let exe = std::env::current_exe()
                    .map(|p| p.display().to_string())
                    .unwrap_or_default();

                warn!("[mac tap] installation failed: accessibility={}, input_monitoring={}, executable={}",
                    crate::macos_access::is_accessibility_trusted(),
                    crate::macos_access::has_input_monitoring_access(), exe);
                if !recovery_shown {
                    if let Some(app) = APP_HANDLE.lock().unwrap().as_ref() {
                        runtime::show_settings(app);
                    }
                    recovery_shown = true;
                }
                std::thread::sleep(std::time::Duration::from_secs(3));
            }

            let mach_port = unsafe { CFMachPort::wrap_under_create_rule(port_ref) };
            let loop_source = match mach_port.create_runloop_source(0) {
                Ok(s) => s,
                Err(()) => {
                    error!("[mac tap] create_runloop_source failed");
                    return;
                }
            };

            let rl = CFRunLoop::get_current();
            rl.add_source(&loop_source, unsafe { kCFRunLoopCommonModes });
            unsafe {
                CGEventTapEnable(mach_port.as_concrete_TypeRef(), true);
            }

            TAP_RUNLOOP.store(
                rl.as_concrete_TypeRef() as *mut c_void,
                Ordering::Release,
            );

            TAP_STATE.with(|c| {
                *c.borrow_mut() = Some(TapState {
                    mach_port,
                    _loop_source: loop_source,
                });
            });

            info!("[mac tap] CGEventTap installed on dedicated thread");
            READY.store(true, Ordering::Release);
            unsafe { CFRunLoopRun(); }
            READY.store(false, Ordering::Release);
            TAP_RUNLOOP.store(std::ptr::null_mut(), Ordering::Release);
            TAP_STATE.with(|c| {
                if let Some(state) = c.borrow_mut().take() {
                    unsafe { CGEventTapEnable(state.mach_port.as_concrete_TypeRef(), false); }
                }
            });
            info!("[mac tap] dedicated thread exiting");
        })
        .expect("failed to spawn keyboard-tap thread");
}

pub fn cleanup() {
    RUNNING.store(false, Ordering::Release);
    READY.store(false, Ordering::Release);
    let rl_ptr = TAP_RUNLOOP.swap(std::ptr::null_mut(), Ordering::AcqRel);
    if !rl_ptr.is_null() {
        unsafe {
            CFRunLoopStop(rl_ptr);
        }
    }
    *APP_HANDLE.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::{keycode_to_name, modifier_down_from_flags};

    #[test]
    fn grave_key_is_recordable_on_ansi_and_iso_keyboards() {
        assert_eq!(keycode_to_name(50), "Backquote");
        assert_eq!(keycode_to_name(10), "Backquote");
    }

    #[test]
    fn modifier_events_use_their_own_flags_even_before_session_state_updates() {
        assert_eq!(modifier_down_from_flags(60, 0x20000), Some(true));
        assert_eq!(modifier_down_from_flags(60, 0), Some(false));
        assert_eq!(modifier_down_from_flags(58, 0x80000), Some(true));
        assert_eq!(modifier_down_from_flags(58, 0), Some(false));
    }

    #[test]
    fn releasing_one_shift_preserves_the_other_shift() {
        assert_eq!(modifier_down_from_flags(56, 0x20004), Some(false));
        assert_eq!(modifier_down_from_flags(60, 0x20004), Some(true));
        assert_eq!(modifier_down_from_flags(56, 0x20002), Some(true));
        assert_eq!(modifier_down_from_flags(60, 0x20002), Some(false));
    }
}
