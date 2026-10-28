# BeaconHop validation ledger

Updated: 2026-10-28. Source implementation, packaged builds and native acceptance are separate.

## Completed checks

| Check | Evidence / result |
| --- | --- |
| Rust interaction and configuration tests | 21 passed: hint allocation, immediate activation and key release ownership, partial-hint cancellation, MRU including rapid pending activations and failed-activation reconciliation, independent scopes, Unicode/phrase search, closed targets, empty inventories and modifier sides |
| Frontend production build | TypeScript and Vite passed; embedded assets are used by both release binaries |
| Browser interaction tests | 4 Playwright tests passed: settings save/discard and independent scopes; IME composition Enter; search/empty results/caret navigation; minimum-window light theme layout |
| Dependency/version/style checks | npm audit: 0 reported vulnerabilities; version consistency, Rust formatting and Git whitespace checks passed |
| macOS builds | Apple Silicon debug app and optimized app + DMG built locally; ad-hoc bundle signature and DMG checksum verified; packaged release startup smoke passed; Swift bridge compiled for a macOS 14 deployment target |
| Windows builds | MSVC x86-64 debug and optimized GUI EXE cross-compiled on this Mac; NSIS installer successfully generated |
| CI definitions | Native macOS/Windows checks and manual package workflow added; not executed remotely because this new project has no publishing remote |

## macOS native evidence

Host: macOS 27.0.1, Apple Silicon, built-in Retina display plus external 2560 × 1440 display, separate Spaces. The actual bundled debug executable had Accessibility, Input Monitoring, Screen Recording and an installed event tap. Tests used two editable fixture windows with native window ID/PID readback; they checked that hint/shortcut characters did not leak into either text field.

The final extended native run passed 207 cases: 100 round trips covering 200 repeated switches, followed by seven search, cancellation, minimized/hidden restoration and fullscreen-Space checks. Passed:

- Alt + Tab selects the previous fixture; modifier release focuses that exact window.
- A complete hint focuses the exact target before Alt is released.
- Backslash enters search and stays there after Alt release; direct Cmd + backquote search also works.
- Search selects the correct same-application window; Escape restores the origin.
- Minimized windows restore; hidden applications unhide at the selected window.
- Cold startup discovers a fixture on another Space. Hint navigation enters and leaves its native fullscreen Space while preserving both windows' desktop membership.
- All four combinations of current/all desktop and current/all display were exercised against native membership and candidate sets, including settings reloads between runs.
- Native thumbnails and the switcher layout were visually inspected. Preview capture is asynchronous and outside the keyboard hook.

Local evidence: `logs/macos-stress-qa.json`, `logs/macos-qa.json`, `logs/macos-scopes-qa.json`, `logs/macos-hidden-qa.json`, `logs/macos-final-qa.json`, and private screenshots under `logs/`. The repeatable extended harness is `python3 scripts/macos-qa.py 100 --extended` (use `2` for a short run); it requires the local fixture, key helper and a debug instance configured with `BEACONHOP_DIAGNOSTICS_FILE` and an isolated `BEACONHOP_DATA_DIR`.

The confirmation times in native QA include helper process startup, synthetic key pacing, inventory publication and polling. They are **not** input-to-paint latency. The 100-cycle result covers the two fixture windows on this host, not arbitrary applications or a P95 speed target. A 12.03-second idle sample with 22 windows measured 4.65% CPU for the debug main process before the subsequent activation fixes. This is not a whole-app power measurement or a release-build performance result; WebView processes and sustained workload benchmarks remain separate.

The additional native edge run passed eight cases (`logs/macos-edge-qa.json`), including ten rapid two-toggle round trips, distinct same-title windows, hidden-application restoration, and a target closing while its hint remains displayed. Closing a target preserves the other hints, shows a visible error, and allows Escape to restore the origin. The installed WeType Pinyin input method was also exercised through physical key events: composition Enter commits text without activating a matching result, a second Enter activates, and committing `你好` searches and focuses the exact selected fixture. The input source was restored after testing. Apple's Pinyin source was unavailable to TIS selection on this host and was not enabled for the test.

These checks exposed and fixed two issues: rapid invocation could use a foreground observation older than the preceding hop, and a hidden application could unhide without transferring keyboard focus. The interaction engine now tracks pending targets separately until native focus confirms or activation fails; stale callbacks cannot overwrite a newer hop. The macOS adapter unhides the application and requests its frontmost state before assigning and verifying the exact target window.

To reproduce the edge checks after building the debug app, compile the local helpers and run the harness. It launches and cleans up its own fixture and debug app, uses the isolated `logs/native-profile/settings.json` profile (Alt+Tab, Super+Backquote, all desktops/displays), and requires native Accessibility/Input Monitoring authorization. It temporarily changes focus and uses an already enabled input method, restoring it on exit.

```sh
mkdir -p logs
for helper in macos-fixture macos-key macos-window macos-input-source macos-field macos-fast-switch; do
  swiftc "scripts/$helper.swift" -o "logs/$helper"
done
python3 scripts/macos-edge-qa.py
```

## Remaining acceptance

**Windows native execution is pending an accessible Windows machine or VM.** Compilation and installer generation do not prove hook interception, DWM preview composition, focus transfer, virtual desktop compatibility, high DPI behavior or installation. Initial desktop-switching support follows `winvd` 0.0.49: Windows 11 24H2 build 26100.2605 or later (upstream also reports testing 25H2 build 26200.8117). Older Windows versions are not accepted targets yet.

Remaining broader acceptance includes Windows native input methods, rapid invocation and target destruction, additional macOS input methods, and both platforms' permission revocation/regrant, unresponsive/protected applications, sleep/wake, display removal, login startup and renderer recovery. Unit/browser evidence covers some of these rules but does not replace native checks. Mac Intel builds have not been produced on this host.

Builds are local development distributions: macOS uses an ad-hoc signature (`signingIdentity = "-"`), with no Developer ID notarization; Windows has no Authenticode signature. No public release, domain registration or updater service has been configured.

## Packaging and implementation notes

- macOS: `src-tauri/target/release/bundle/macos/BeaconHop.app` and `src-tauri/target/release/bundle/dmg/BeaconHop_0.1.0_aarch64.dmg`.
- Windows: `src-tauri/target/x86_64-pc-windows-msvc/release/beaconhop.exe` and `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/BeaconHop_0.1.0_x64-setup.exe`.
- `strip = "none"` preserves host procedural-macro metadata during this Mac's release cross-build; stripping it caused `proc_macro_hack` dependency loading to fail.
- The Windows build used cargo-xwin, the Microsoft SDK/CRT, clang in MSVC mode, rust-lld, Zig's resource compiler and NSIS. The downloaded Tauri NSIS utility DLL matched the SHA-1 pinned by Tauri (`6532da4545864c6ec95f62f27f2199bfd668560b`). See [Tauri's cross-build guide](https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos).
- macOS Space membership and unlisted AX root acquisition use dynamically resolved private APIs. The AX remote-token ABI and published-window limitation were researched in [AltTab's API wrapper](https://github.com/lwouis/alt-tab-macos/blob/master/src/macos/api-wrappers/AXUIElement.swift); BeaconHop's bounded discovery/cache implementation is independent. These paths need regression checks when macOS changes.
- Diagnostics exclude window titles by default. Test screenshots and traces stay in ignored `logs/`. Neither the Screen Buoy working tree nor its unpublished edits were modified.
- CI uses `macos-15` for Apple Silicon builds while retaining a macOS 14 deployment target. The previous `macos-14` runner is being retired; see [GitHub's retirement notice](https://github.blog/changelog/2026-10-01-github-actions-macos-14-runner-image-retirement/). Remote CI execution remains pending a repository remote.
