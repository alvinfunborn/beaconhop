# BeaconHop validation ledger

Updated: 2026-10-29. Source implementation, packaged builds and native acceptance are separate. Dated entries describe their respective build, not necessarily the current executable.

## Completed checks

| Check | Evidence / result |
| --- | --- |
| Rust interaction and configuration tests | 23 passed: hint allocation, immediate activation and key release ownership, partial-hint cancellation, MRU including rapid pending activations and failed-activation reconciliation, independent scopes, Unicode/phrase search, closed targets, empty inventories, modifier sides and ANSI/ISO grave-key mapping |
| Frontend production build | TypeScript and Vite passed; embedded assets are used by both release binaries |
| Browser interaction tests | 10 Playwright tests passed: settings save/discard and independent scopes; IME composition Enter; search/empty results/caret navigation; minimum-window light theme layout; a working keyboard hook without Input Monitoring; collapsed recovery and screen-permission button feedback; shortcut recording/default feedback; all-visible aspect-preserving layouts for 6/24/80 windows |
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

## Window-stack branding and local installation

The 2026-10-28 branding update replaces the letter B with three rising windows, a fading violet motion trail and an amber H hint key. SVG, Windows PNG/ICO and native macOS ICNS assets were regenerated. The macOS icon uses Icon Composer's native silhouette with 824-pixel artwork on a 1024-pixel transparent canvas. The menu bar now uses a monochrome window-stack template instead of the full-color app icon. Visual checks covered 16/32/64/128/256 pixels and light/dark menu bar backgrounds.

The updated TypeScript/Vite and macOS release app/DMG builds passed, as did Rust formatting, Git whitespace checks, strict bundle signature validation and DMG checksum verification. The app was installed and launched at `/Applications/BeaconHop.app`; the installed executable SHA-256 and ICNS match the packaged app. Evidence is in `logs/macos-install.json` and `logs/logo-size-review.png`.

Installed-app diagnostics confirmed Accessibility access, an active native keyboard hook, 11 inventoried windows across two displays, and no warnings. Native Cmd+backquote opened the installed switcher; Escape returned to settings. AltTab was temporarily quit to avoid competing shortcuts. At this handoff, Input Monitoring and Screen Recording were not enabled; the keyboard hook was active through Accessibility, while thumbnails still required Screen Recording approval. The settings window was left open on System & access, and the screen-capture permission request was issued from BeaconHop's own button.

The existing Windows EXE/installer predates this branding update; Windows icon sources are updated, but that package has not been rebuilt in this macOS installation follow-up.

## Menu bar and permission follow-up

The monochrome template now uses the main logo's exact -11-degree window rotation, layer positions, proportions and H hint, with transparent cutouts and opacity replacing color. Its light/dark rendering was visually checked in `logs/tray-logo-alignment.png`.

Permission buttons now request access and explicitly open the matching System Settings pane, with pending, success and error feedback. Accessibility and the actual running keyboard hook determine readiness, matching Screen Buoy. Input Monitoring is an optional, collapsed troubleshooting entry only while the keyboard hook is unavailable. Screen Recording remains separate and enables thumbnails.

All 21 Rust tests and six browser tests passed, along with the TypeScript/Vite build, Rust formatting and Git whitespace checks. The optimized macOS app and DMG were rebuilt; strict bundle signature and DMG checksum verification passed. The installed app was backed up and replaced without changing settings. Its executable SHA-256 matches the packaged executable (`815f84b5ed27e37c4de3b007d87e5c16ad9ad5811088683a81d762e82444b00a`).

From the newly installed application's own UI, a native Accessibility press on the Screen Recording button opened System Settings at **录屏与系统录音**, with BeaconHop listed. The application displayed its success feedback, and the native log confirmed `screen (Privacy_ScreenCapture)`. Evidence: `logs/macos-permissions-followup.json` and `logs/macos-permissions-followup-ax.txt`.

The replacement executable no longer has the previous ad-hoc build's Accessibility approval: current installed diagnostics report Accessibility false, keyboard hook false, Input Monitoring false and Screen Recording false. No protected permission switch was changed by automation. The user must reauthorize the installed BeaconHop before keyboard switching can be accepted again; the earlier native switching results above were not rerun for this permission-only follow-up.

## Native icon catalog, shortcuts, tiling and recency follow-up

The macOS app now ships an Icon Composer `Assets.car` at `Contents/Resources` and declares `CFBundleIconName=BeaconHop`. The existing padded ICNS remains the older-macOS fallback. An actual System Settings screenshot of the newly installed app confirms the extra light backing plate is gone (`logs/system-settings-beaconhop-icon.png`); an NSWorkspace icon readback is in `logs/installed-native-icon-256.png`.

The local search shortcut was restored from `Super+7` to `Super+Backquote`, preserving every other setting. Recording now subscribes before enabling the native recorder, supports focused WebView fallback and the macOS ISO grave-key code, ignores repeat events, gives explicit same-value feedback, and provides a restore-default button. Win is represented by Super internally and by Command on a Mac.

The overview sizes its native panel to the inventory and available display. All matching windows fit without scrolling, in usage order, with each preview retaining its native window aspect ratio. Grid and compact layouts resize to fit. Recent external focus observations and BeaconHop activations determine ordering; search filters that order rather than sorting by match score.

Validation: 23 Rust tests passed, including ANSI/ISO key mapping and usage order despite reordered native inventory and search; ten Playwright tests passed, including same-shortcut feedback, Win+backquote and restore-default recording, plus all-visible, non-overlapping aspect-preserving grids for 6/24/80 mixed portrait and landscape windows at 1000×680, resized grids at 760×580, and all-visible compact layouts at 760×580. TypeScript/Vite build, formatting, whitespace/version checks and the Windows x86-64 MSVC cross-check passed. The optimized app/DMG passed signature and checksum checks and were installed; executable and native icon catalog match the package. Evidence: `logs/macos-tiling-install.json`, `logs/tiles-{6,24,80}.png`.

At installation readback, the replacement executable again reported Accessibility false and keyboard hook false; the existing development signature does not preserve TCC approval across these rebuilds. No OS grant was changed by automation. A controlled native probe confirmed BeaconHop was foreground before Cmd+backquote, then uTools became foreground; no recording-completion feedback arrived while BeaconHop lacked its hook. Global-shortcut, actual-window MRU and thumbnail-grid acceptance on this replacement remain dependent on the user reauthorizing Accessibility and Screen Recording. The older extended native switching results above are historical, not a rerun of this build.

## Minimal tray menu follow-up

The tray context menu now contains only Open Settings, Restart and Quit, in that order, matching Screen Buoy. Labels follow the configured English/Chinese preference or the system locale and refresh after saving language settings. Restart requests the normal Tauri exit lifecycle so native input cleanup runs before relaunch.

The optimized macOS app and DMG rebuilt successfully, the Windows MSVC cross-check passed, and formatting/whitespace checks passed. The staged app signature and DMG checksum were verified. The installed executable matches the package; all settings remained unchanged through installation, restart and quit. Native right-click probes read exactly `打开设置`, `重启`, `退出`; Restart replaced PID 95272 with 96178, Quit left zero installed instances, and Open Settings reopened the settings window after closing it. The settings window was confirmed on screen; foreground focus was not accepted because the subsequent readback showed Edge active. BeaconHop was relaunched and left running. Evidence: `logs/macos-tray-install.json`.

## Shortcut entry and startup access guidance

Both shortcut editors now provide recording, manual entry and restore-default actions with consistent same-value feedback. The backend accepts Backslash as a global shortcut key; Win/Command + backslash can open search while plain backslash remains normal typing outside a switcher session. Manual entry accepts Win/Cmd/Super aliases, backquote and backslash, so configuration can be completed before Accessibility is granted.

Following the current ainput permission flow, missing Accessibility overrides background startup and opens the settings window on System & access. The prominent card explains the required grant, offers a direct System Settings action and stale-grant recovery, and separates keyboard-hook readiness from optional Screen Recording for previews. Other settings pages retain a permission banner. Input Monitoring remains collapsed troubleshooting rather than a mandatory onboarding step.

Validation: 24 Rust tests and 12 Playwright tests passed, including both editors, punctuation recording/manual entry, independent defaults, invalid input, saving without grants and permission refresh. TypeScript/Vite build, Windows x86-64 MSVC cross-check, formatting and whitespace checks passed. The optimized macOS app/DMG passed strict signature and DMG checksum verification and was installed with all settings preserved; installed executable SHA-256 is `7a140f7180695fec5499553cd1148dadefccabafd29b9254b6d76a4caf95e748` and matches the package.

A Launch Services background launch (`open -g ... --args --background`) was observed becoming foreground within 0.56 seconds while its own native log reported Accessibility false and a failed hook. Its native accessibility tree and window screenshot confirm the authorization card and primary button are visible. This timing is launch-to-foreground for this local probe, not a general startup performance claim. Native manual entry saved `Super+Backslash`, verified by configuration readback; restoring the search default saved `Super+Backquote`, preserving every other setting. A second manual-typing probe was interrupted by foreground ownership and is not accepted as native backquote recording evidence; the browser test covers that manual-entry path. Evidence: `logs/macos-shortcuts-access-install.json`, `logs/macos-shortcuts-access-native.json`, `logs/macos-startup-background-focus.txt`, `logs/macos-startup-access-final-ax.txt` and `logs/macos-permission-startup-native.png`.

The ordinary installed Launch Services process still lacks Accessibility and an active hook. Global shortcut interception and window switching on this replacement remain pending the user's OS grant; no protected permission switch was changed. A direct executable launch from an authorized helper inherited different TCC behavior and was excluded from installed-app permission acceptance.

## Adaptive previews, pinyin, stable hints and spatial navigation

The panel now uses native macOS vibrancy / Windows Acrylic beneath a lightly translucent surface. Thumbnails and text remain clear; opaque amber badges with dark text, a dark border and an outer light ring are centered in previews. The panel sizes itself from the full invocation inventory and actual window aspects, keeping its size while search filters results. A 460 × 396 one-window browser check confirms cards and controls fit; existing 6/24/80-window checks cover mixed aspects and no scrolling.

macOS now queries ScreenCaptureKit shareable content once per batch, allows four captures in flight, scales to a 512-pixel long edge and uses JPEG previews. Cached reads do not wait behind captures. The frontend decodes a batch before publishing it; canceled sessions cannot publish a late refresh. Startup warms up to 80 inventoried windows; subsequent inactive focus changes refresh the foreground window. Cache pixels remain in memory only. On this Mac, two alternating measurements over the same 12 on-screen windows captured all 12: the old sequential implementation took 2691/2018 ms and the new batch implementation took 991/729 ms (about 2.7×). This includes format/capture changes and measures helper-side capture time, not universal hotkey latency. Evidence: `logs/thumbnail-benchmark.txt`.

Search indexes full pinyin, initials and heteronym readings without enumerating every combination. It normalizes Latin diacritics and full-width letters, keeps AND matching across words and preserves MRU ordering. Index updates follow title changes and window destruction. Japanese kanji readings and Korean initial-consonant matching remain future language-specific work.

Hints are allocated by native window identity using a stable hash among available short codes, with collision handling and a prefix-free expansion tree. The first 24 default letters can stay single-key while reserved branches accommodate growth without renaming existing codes. The local `hints.json` file preserves assignments through BeaconHop restarts; reordered inventory, MRU changes, search and scope changes do not reassign a living window. Closed/recreated windows are new identities. Corrupt/incompatible stored data falls back to rebuilding the mapping.

All four arrows use the visible card geometry in hold and search modes, including the search field. Up/Down target the next visual row and its nearest horizontal center; Left/Right target an adjacent card in the current row. Tab retains MRU traversal. The native hook consumes held-mode key releases. Settings has a persistent footer restart action and prevents restart while unsaved changes are present. On macOS, both settings and tray restart through Launch Services after the old instance exits. Direct binary restart was observed to retain hint data but leave activation unreliable; relaunching through Launch Services restored native hold/search focus and navigation.

Validation: 33 Rust tests and 17 Playwright tests passed, including stable hints during growth, reordering, restart serialization and scope changes; held-mode key ownership; uneven-row spatial navigation; all four arrows from the search field; cached batch publication and late-session cancellation; centered high-contrast badges; small panel controls; restart draft protection; existing shortcut and IME behavior. TypeScript/Vite, Windows x86-64 MSVC check, formatting, whitespace and version checks passed. Native installed-app readback and current distribution hashes follow below. Windows native DWM composition and runtime switching still require a Windows host.

Native Mac checks on the installed adaptive-preview build found 22 windows and 22 cached previews, with Accessibility, Screen Recording and the keyboard hook ready. Native AX readback confirmed selection changes for Right/Down/Left/Up in both hold and search modes. Full pinyin `feishu` and initials `fs` both included 飞书, while keeping the 1927 × 1098 invocation panel size; initials can also match other app/title substrings. A native screenshot confirmed centered amber badges and the translucent panel. The persistent settings restart changed PID 75056 → 84044, preserved all 22 common window hint assignments and left settings unchanged. Evidence: `logs/native-preview-navigation-result.json`, `logs/native-glass-panel.png`, `logs/native-hint-restart-result.json`. The final rebuild below additionally changes native restart to Launch Services and adds the four-arrow footer legend; native acceptance of that final restart path is pending local unlock.

Final distributions were rebuilt successfully and the Apple Silicon app was installed at `/Applications/BeaconHop.app` at 18:17 on 2026-10-28, preserving user settings and the native icon catalog. Strict code-signature verification and the DMG checksum passed. SHA-256 values: installed executable `1f17ee2994af64eb2fb61f4e5e6214beb70bbfe6fc142aa89384e18d742e5ee5`; DMG `c0e3685e462d4f2c57d0660d3a09ccecc941c6095e8ffd183d15c6b296242d22`; Windows NSIS `378f97c894a9479ce5a7bd9ee70bc9c26af9513fec40963322dddc480955e948`. Final Windows release cross-compilation and NSIS packaging passed.

The Mac auto-locked during final installation (`CGSSessionScreenIsLocked = 1`, foreground `loginwindow`). The final ad-hoc signature invalidated the earlier Accessibility grant; the new process currently reports Accessibility/input monitoring false and cannot install its keyboard hook. Native System Settings controls cannot be accessed while locked. The user has been asked to unlock locally; final regrant, restart/focus and repeat navigation acceptance remain pending that input. Earlier native checks above are explicitly for the preceding build, not proof that the final signed executable is authorized. No TCC database changes or security bypasses were used.

## 2026-10-29: configurable hints, search entry and signed updater

The current source passes 41 Rust tests and 23 browser interaction tests. Four targeted browser checks additionally passed after removing the old 28px badge-size ceiling: custom font size/colors/opacity/radius reach the actual switcher badges, and 6/24/80-window layouts remain visible without scrolling. Configuration tests cover migration from old settings, persisted hint styling, field validation and a separate configurable hold-to-search key. Backquote is now the default hold-to-search key; historical backslash checks above apply to earlier builds.

Search indexing now includes the bundle ID/executable name in addition to localized application name and window title. Tests cover `Finder`, 访达, full pinyin/initials, title pinyin, index invalidation and explicit exclusion. On this Mac the actual Finder AX window inventory includes 下载; the stored exclusion list is empty. The gray exclusion placeholder is an example, not an active rule.

Both settings and the switcher now use active native Sidebar vibrancy on macOS and Acrylic on Windows, behind a configurable surface tint (default 24%). Hint appearance has independent background opacity. A native screenshot from the intermediate installed build shows background color variation through the switcher; subjective visual acceptance remains with the user. After its installation and normal System Settings regrant, native diagnostics confirmed Accessibility, Input Monitoring, Screen Recording and the keyboard hook ready, with previews present. An additional navigation/search automation attempt was interrupted by foreground changes and is not counted as a pass.

Signed updater discovery, download progress, verification/install/restart and error recovery are implemented. Browser tests simulate successful downloads/install, verification failure before installation and retry after a network failure. Rust tests verify semantic-version ordering, downgrade prevention and repository-bound redirects. The manual package workflow and manifest generator validate successfully. These checks do not establish a real old-to-new update: no release has been published. The current source repository is private; a public update channel remains a distribution decision. See [update setup](updates.md).

## Remaining acceptance

**Windows native execution is pending an accessible Windows machine or VM.** Compilation and installer generation do not prove hook interception, DWM preview composition, focus transfer, virtual desktop compatibility, high DPI behavior or installation. Initial desktop-switching support follows `winvd` 0.0.49: Windows 11 24H2 build 26100.2605 or later (upstream also reports testing 25H2 build 26200.8117). Older Windows versions are not accepted targets yet.

Remaining broader acceptance includes Windows native input methods, rapid invocation and target destruction, additional macOS input methods, and both platforms' permission revocation/regrant, unresponsive/protected applications, sleep/wake, display removal, login startup and renderer recovery. Unit/browser evidence covers some of these rules but does not replace native checks. Mac Intel builds have not been produced on this host.

Builds are local development distributions: macOS uses an ad-hoc signature (`signingIdentity = "-"`), with no Developer ID notarization; Windows has no Authenticode signature. Updater package signing and manual GitHub release configuration are implemented. No public release or publicly accessible update source has been published.

## Packaging and implementation notes

- macOS: `src-tauri/target/release/bundle/macos/BeaconHop.app` and `src-tauri/target/release/bundle/dmg/BeaconHop_0.1.0_aarch64.dmg`.
- Windows: `src-tauri/target/x86_64-pc-windows-msvc/release/beaconhop.exe` and `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/BeaconHop_0.1.0_x64-setup.exe`.
- `strip = "none"` preserves host procedural-macro metadata during this Mac's release cross-build; stripping it caused `proc_macro_hack` dependency loading to fail.
- The Windows build used cargo-xwin, the Microsoft SDK/CRT, clang in MSVC mode, rust-lld, Zig's resource compiler and NSIS. The downloaded Tauri NSIS utility DLL matched the SHA-1 pinned by Tauri (`6532da4545864c6ec95f62f27f2199bfd668560b`). See [Tauri's cross-build guide](https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos).
- macOS Space membership and unlisted AX root acquisition use dynamically resolved private APIs. The AX remote-token ABI and published-window limitation were researched in [AltTab's API wrapper](https://github.com/lwouis/alt-tab-macos/blob/master/src/macos/api-wrappers/AXUIElement.swift); BeaconHop's bounded discovery/cache implementation is independent. These paths need regression checks when macOS changes.
- Diagnostics exclude window titles by default. Test screenshots and traces stay in ignored `logs/`. Neither the Screen Buoy working tree nor its unpublished edits were modified.
- CI uses `macos-15` for Apple Silicon builds while retaining a macOS 14 deployment target. The previous `macos-14` runner is being retired; see [GitHub's retirement notice](https://github.blog/changelog/2026-10-01-github-actions-macos-14-runner-image-retirement/). Remote CI execution remains pending a repository remote.
