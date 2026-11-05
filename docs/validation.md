# BeaconHop validation ledger

Updated: 2026-11-05. Source implementation, packaged builds and native acceptance are separate. Dated entries describe their respective build, not necessarily the current executable.

## 2026-11-05 proportional native thumbnail sizes

The shared desktop overview now applies one common preview scale per physical
display instead of narrowing every window into a similar size range. Native
width and height ratios are preserved across desktops, including wide, portrait,
hidden and minimized windows. Captions have their own height. Desktop placement
guides use total native window area, and compact packing retains relative
desktop order without fixed columns.

Validation: all 70 UI tests passed, including mixed-size density, exact common
scales after wide/portrait resize, search stability, desktop ownership, centered
hints and navigation. The debug app/DMG built and the app was installed with the
same signing requirement and unchanged BH/SB settings. Native readback found 24
thumbnails on two displays, including both previously missing inactive-desktop
windows. Eight real VS Code previews shared a common width/height scale within
each display (approximately 0.239 and 0.256, with integer AX bounds); all 24
targets passed a complete forward/reverse Tab cycle. The session was cancelled
to inactive. Evidence and backup: ignored `logs/native-size-20261105/`.

## 2026-11-05 off-desktop window inventory recovery

The installed overview omitted two real VS Code windows on inactive desktops 3
and 4, although WindowServer still reported both. Remote AX discovery retained
its old scan cursor after cached roots disappeared, so an older element behind
that cursor could not be found again. Changed missing-window targets now restart
the bounded sweep; unchanged searches continue across inventories. Completed
inventories clear obsolete retry and backoff state.

The read-only native regression `python3 scripts/macos-inventory-recovery.py PID
WINDOW_ID` compiles the actual bridge, discovers an existing inactive-Space
window, and simulates candidate omission and AX root eviction within its own
cache. It does not activate or move the target. Against the same native window,
the old bridge failed recovery after omission; the fixed bridge passed both
recovery cases and stale-retry cleanup. The fixed bridge also passed against the
second missing window. This simulates cache loss without locking the user's Mac;
an actual lock/unlock cycle was not performed.

Validation: 117 Rust tests passed, two ignored, and the debug macOS app/DMG build
passed. The installed app retained its signing requirement and byte-identical
BH/SB settings. Both previously missing native IDs reappeared with their original
desktop and display memberships. Evidence and installation backup are under
ignored `logs/cross-desktop-20261105/`; regression receipts are under ignored
`logs/inventory-recovery-*/`.

Native overview acceptance found all 26 thumbnails across two physical displays,
including both recovered inactive-desktop targets. A full forward Tab cycle
visited every thumbnail once; Shift+Tab reversed all 26 steps. The test cancelled
back to inactive mode. AX rounds WebView bounds to integer pixels, so a previous
strict row-order comparison was ambiguous at a row threshold; the completed
native check verifies complete traversal and exact reversal instead.

## 2026-11-02 browser bridge resets, website icons and hint spacing

The installed browser host reproduced `Connection reset by peer` when a real authenticated client waited 50 or 200 ms between connecting and sending its request; immediate sending succeeded. Its nonblocking listener produced nonblocking accepted streams on macOS. The host now explicitly makes each accepted stream blocking before applying bounded read/write timeouts, allowing delayed and fragmented requests.

The browser extension now reads small PNG favicons from Chromium's local `_favicon` resource with the `favicon` permission, caches them in its worker and includes them for the focused window. The core accepts bounded inline PNGs, drops remote/oversized icons and no longer substitutes the Edge application icon for browser tabs. Missing images use the page-title initial. Content rows reserve a separate hint column sized for the configured font, avoiding overlap with the site icon. Tab screenshots remain unimplemented; they require a separate capture/cache lifecycle for previously viewed pages.

Validation: 91 Rust tests and five navigation UI tests passed. The UI regression and inspected screenshot cover two-character hints at 36 px on a 760 px window. The packaged native-host executable passed the browser-adapter protocol test, including 100 ms delayed and fragmented list/activation requests, favicon transfer, moved/closed target rejection, authentication and host cleanup. The frontend and optimized macOS build passed.

The updated app was installed with its existing signing requirement and unchanged BH/SB settings; installed executable SHA-256 is `5e663d8cd2c9ca20fb5bc5cf559657ad2cd237c00d36f8befcad6c528ca5769a`. The existing Edge extension was reloaded through its own management card. Independent real Edge checks then passed at 0/50/200 ms delays with fragmented messages, returning three browser windows and 22 website icons for 23 tabs in the focused window (seven distinct images). A delayed activation request for a nonexistent tab returned the browser's explicit rejection instead of resetting the socket. The two temporary extension-management windows were closed and independently confirmed absent. SB remained running. No physical Ctrl+Tab gesture or successful real-tab switch was replayed in this round. Build resources were released. Evidence, scoped source diffs, layout screenshot and installation backups are under ignored `logs/browser-repair-20261102/`.

## 2026-11-02 desktop shortcut returns to the previous desktop

The desktop shortcut previously selected the next desktop in inventory order, so desktop 1 → 2 followed by another invocation selected desktop 3 rather than returning to desktop 1. The engine now keeps desktop recency separately from window recency, updating it on confirmed current-desktop transitions, including switches outside BeaconHop. Forward invocation prefers the most recently visited noncurrent desktop; with no history it retains the next-desktop fallback. Overview positions and hints remain stable, and further Tab/Shift+Tab navigation and reverse invocation follow overview order. Shared-Space current-desktop lookup also recognizes participating displays rather than only the activation anchor.

Validation: 91 Rust tests passed, one ignored. Regressions exercise repeated 1 ↔ 2 shortcut press/release sequences, unchanged hints and card order, repeated inventory polls, external desktop changes, failed requests, removed desktops, reverse/further navigation and an external display sharing the current Space. Frontend and optimized macOS app builds passed; formatting and whitespace checks passed.

BeaconHop was installed and restarted at 14:23 with the existing signing requirement and byte-identical BH/SB settings. Independent readback verified the installed executable SHA-256 `5af77e573bda7026a65a80e477c4521ff9800e6ba6a6b5eb82ce02cb02fe6acd`, strict bundle signature, tested source hashes, Accessibility grant and installed event tap. Screen Buoy was not replaced or restarted. History starts with observations made by the new process; it is not persisted across restarts. No synthetic input or Space switching was performed, so physical-key desktop round-trip acceptance remains pending. The build lease was released; evidence and backups are under ignored `logs/desktop-mru-20261102/`.

## 2026-11-02 shared-desktop hints across displays

The desktop continuation previously validated a shared macOS Space correctly but returned only its activation-anchor display's bounds. Screen Buoy consequently filtered out the other display's grids and controls. A native `Main` managed-display group now includes every active display after validating the requested Space and anchor; UUID groups retain their individual display scope. Geometry is sorted before session comparisons so enumeration-order changes do not dismiss an otherwise unchanged session.

Validation: 101 SB Rust tests passed, two ignored. New regressions cover shared versus separate display scopes, negative coordinates, stable geometry ordering, disconnected anchors, and cached controls on both displays while excluding the gap. The existing grid test covers distinct overlay indices and shared hint allocation. A separate read-only native test passed against the current shared Space, returning both actual display bounds: `(-385,-1440,2560,1440)` and `(0,0,1800,1169)`. It did not switch Spaces or inject input.

The frontend and optimized macOS build passed. Screen Buoy was installed at 11:40 with its existing signing requirement and byte-identical BH/SB settings; BH was not replaced or restarted. Independent signature/hash verification passed for SB executable SHA-256 `6cf91383d763e4ba122018f9504a11345445d861bac2eb6fdf77acde7a3f8d3f`. Protocol-3 status confirmed Accessibility, Input Monitoring and keyboard hook ready.

The controlled desktop-handoff request succeeded, but its initial AX read exposed no WebView descendants, so that attempt did not establish rendered hint counts or uniqueness. Its own test process was stopped and SB relaunched with readiness verified. Subsequent read-only WindowServer captures of the installed app showed both layer-25 overlays at the two expected display frames; both transparent-window screenshots were visually checked and contained grid and control hints. The entry gesture of that later user-active session was not captured, so these screenshots establish dual-display rendering separately from the native desktop-scope test, not a full replay of Ctrl+Win+Tab → held hint → right neighbour. No synthetic input was sent and no Windows runtime test was performed. Build resources and probe processes were released; the user's running apps and active hint session were retained. Evidence is under ignored `logs/desktop-displays-20261102/`, including `native-scope.log`, `visible-overlays.json`, `visible-overlay-{0,1}.png`, `verification.json` and `probe-cleanup.json`.

## 2026-11-02 desktop selection and Screen Buoy focus checks

Held shortcuts now commit on release of all their configured modifiers. This Mac's Karabiner Ctrl-to-Command mappings accept additional modifiers: a temporary Ctrl release before a mapped hint could previously commit the highlighted desktop before that hint arrived. Regression tests reproduce that event sequence and verify the exact selected desktop is activated once with either modifier-release order. Activation logs now include the session, target and desktop IDs.

Screen Buoy now resolves the target application by PID and verifies its `AXFrontmost` and exact `AXFocusedWindow` ID. Its previous system-wide `AXFocusedApplication` query returned `AXErrorNoValue` on this Mac while the actual foreground application's window remained available. A read-only native comparison of the old and new Rust functions against the same foreground Lark window returned `old=false`, `new=true`; wrong-window and wrong-PID checks both returned false. This isolates the focus-query defect without claiming the reported VS Code sequence has been replayed. The installed BH log also contained two failed SB focus validations at 10:30 on November 2.

While a Screen Buoy request is pending, a fresh nonmodifier key cancels the request and is consumed, including its repeats and release, rather than reaching the selected application's editor. The regression asserts this behavior. Validation: BH 88 Rust tests passed, one ignored; SB 98 passed, two ignored; BH Rust formatting and both repositories' whitespace checks passed. Both frontend and optimized macOS app builds passed.

Both apps were installed and restarted at 11:02 with their existing signing requirements and byte-identical user configurations. Independent readback verified both installed executable hashes and strict bundle signatures. BH's new process logged Accessibility granted and its event tap installed; SB's protocol-3 status reported Accessibility, Input Monitoring and keyboard hook ready. Foreground remained on the user's existing application during installation. Installed executable SHA-256: BH `19891652dcd9bd59fe8a6fcfc968f7ad9f02a7b1617bac70a48ba4f3583e9531`; SB `9c31f23f9cbedb8916b2362c4ff0b6664640e68e72a3184f1aaa20213a16933a`.

Physical-key acceptance of the reported desktop choice and held-hint continuation into VS Code remains pending; no synthetic input or focus switching was performed in this run. No Windows runtime acceptance is claimed. Evidence, installation receipts, app/config backups and scoped before/after source copies are under ignored `logs/focus-fix-20261102/`.

## 2026-10-30 shared-desktop previews and local browser setup

Shared macOS Spaces now expose all participating display IDs for desktop previews while retaining their native activation anchor. The two-display regression checks both display membership and external-screen windows, then checks the separate-display case. Final Rust verification: 86 passed, 1 ignored; navigation UI: 4 passed; frontend and optimized macOS app builds passed. A read-only native probe confirmed two physical displays, four shared Spaces and both display IDs on every Space.

The local Edge profile had neither the browser extension nor its Native Messaging registration. Both are now installed; an authenticated request through the real Edge extension/native host successfully listed its normal-window contexts. An Edge-specific Karabiner rule mapped Control+Tab with any additional modifiers to Control+0, also intercepting Control+Command+Tab. Only that conflicting manipulator was removed, with a local backup. Browser setup and key-remapping troubleshooting are documented in `plugins/README.md` and `docs/navigation.md`.

The app was installed at 16:32 with the existing Apple Development signing identity and byte-identical settings. Installed executable SHA-256: `64b5aa1a976e87720bc48b1c11054ac4d762017c22f73bf0799d8e41bd3cbcbe`; strict signature verification passed. Tab inventory errors now log the provider application's ID and failure reason for follow-up diagnosis.

Native acceptance is **incomplete**: scripted browser gestures were interrupted by focus changes, and the Mac subsequently locked (foreground `loginwindow`). This does not establish successful physical shortcuts, exact tab activation through the held-key UI, or final visual acceptance of the installed multi-display overview. AutoRaise was briefly paused for isolated checks and resumed; its configuration was unchanged. The two owned test tabs/window and the owned extension-setup tab were removed. Evidence, config/app backups and build/test logs are under the ignored `logs/navigation-fix-20261030/` directory; no Windows runtime acceptance was performed.

## 2026-10-30 immediate BH continuation

BH now requests the next layer on the continuation keydown. It tracks the physical keys still held from the previous gesture, filters their repeats/releases, and excludes their held modifiers from fresh shortcut/hint matching. A new sticky layer accepts fresh input without requiring the old gesture to be released. Native target verification remains required; failed or unverified activation invalidates queued continuation. Settings help and navigation documentation describe this timing.

Validation: 86 Rust tests passed (one existing native probe ignored), including all six release orders, modifier and Enter alternatives, a held opening Tab, fresh Tab/hint input with old modifiers held, delayed tab loading, cancellation, and consecutive BH layers followed by SB. All 11 navigation/SB Playwright tests passed. Production build, Rust formatting and whitespace checks passed.

The release was installed with the same signing requirement and unchanged settings. Initial installed diagnostics confirmed all BH permissions and the keyboard hook ready without regranting. During interactive testing the installed application was independently re-signed/restarted and the foreground changed. A read-only segment comparison confirmed that its executable code still matches this build. Native key testing stopped without a completed pass; interactive acceptance is pending desktop availability. This entry does not claim Windows runtime or a completed real VS Code tab-switch test. Evidence and the guarded native harness are in `logs/continuation-20261030/`; automated logs are `logs/continuation-rust.log` and `logs/continuation-ui.log`.

## 2026-10-30 local overwrite installation

BeaconHop and ScreenBuoy are installed as local release bundles in `/Applications`, signed with a stable Apple Development identity. This is local signing, not Developer ID distribution or notarization. Existing BH settings and the SB user configuration were preserved; previous apps and configuration are backed up under `logs/install-20261030/backup/`.

The installed diagnostic build passed Chinese desktop labels and thumbnails in held/search modes, application-layer continuation after every originating key is released, both hint neighbours and Enter opening window-scoped SB before key release, and desktop hint → desktop-scoped SB. An SB hint clicked a controlled fixture button without typing into its editor. The final release repeated both desktop-entry checks and actual desktop activation.

Native testing found that this Mac's macOS 27.0.1 exposes Mission Control's display controls under WindowManager, while Dock retains an empty `mc` placeholder. Supporting both owners fixed activation. The final installed release completed desktop 1 → 2 → 1 through BH shortcuts, independently reading back Space IDs 6 → 7 → 6. Final diagnostics reported 23 windows/previews, two displays, four desktops, all BH permissions and the keyboard hook ready, and no warnings. SB's protocol-3 status handshake reported ready.

Replacing BH with a different release binary under the same signing requirement retained permissions without regranting; the subsequent Mission Control fix retained them again. Exact installed hashes and phase-specific evidence: `logs/install-20261030/verification.json`. These checks do not establish Windows runtime or GUI tab-adapter acceptance.

## Completed checks

| Check | Evidence / result |
| --- | --- |
| Rust interaction and configuration tests | 41 passed, including hint allocation, activation/key release ownership, MRU, independent scopes, multilingual search and Finder aliases, configurable search entry, hint appearance migration/validation and release discovery |
| Frontend production build | TypeScript and Vite passed; embedded assets are used by both release binaries |
| Browser interaction tests | 23 Playwright tests passed, covering settings and scopes, IME/search/navigation, permission feedback, shortcut recording/manual/default handling, all-visible layouts, customizable hints and simulated signed-update states |
| Dependency/version/style checks | npm audit: 0 reported vulnerabilities; version consistency, Rust formatting and Git whitespace checks passed |
| macOS builds | Apple Silicon debug app and optimized app + DMG built locally; ad-hoc bundle signature and DMG checksum verified; packaged release startup smoke passed; Swift bridge compiled for a macOS 14 deployment target |
| Windows builds | MSVC x86-64 debug and optimized GUI EXE cross-compiled on this Mac; NSIS installer successfully generated |
| CI definitions | Native macOS/Windows checks run on source pushes; packaging is manual and defaults to no publication. See the dated entries below for current-run evidence. |

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

The final source was committed and pushed as `1c29779eab978697e4817512345a8d3ac6392cb9`. Optimized macOS app/DMG and Windows x64 EXE/NSIS builds passed. Both real updater packages were signed with the BeaconHop key and verified against the committed public key; modifying a byte was rejected on both. A complete two-platform manifest was generated locally. Evidence: `logs/updates-package-verification.json`, `logs/updates-macos-signed-build.log`, `logs/updates-windows-signed-build.log` and `logs/updates-windows-signed-bundle.log`.

The corresponding native-host CI run, [Check BeaconHop #40807299963](https://github.com/alvinfunborn/beaconhop/actions/runs/40807299963), passed on both macOS and Windows, including tests, frontend compilation and debug packaging. This does not replace interactive Windows acceptance. Documentation-only follow-ups do not rebuild these unchanged binaries.

The final Mac app was installed at 10:37 on 2026-10-29, preserving settings and the native icon catalog. Its executable SHA-256 is `4ae4886046571354f40e775c5dcd03b124eb0d39c8279165030e00d5d6ce39ba`, matching the bundled source executable. macOS invalidated the earlier ad-hoc application's grants. After the user's local identity verification, BeaconHop's own Accessibility and Screen Recording grants were restored through standard System Settings; only BeaconHop was restarted. Final diagnostics confirmed Accessibility, Input Monitoring, Screen Recording and the keyboard hook ready, with 24 windows and 24 previews across two displays. No security database edits or authentication bypasses were used. Evidence: `logs/updates-final-install.json` and `logs/updates-final-native-diagnostics.json`.

Native key events on that final executable confirmed Alt+Tab opens hold mode, backquote enters persistent search after Alt release, and Cmd+backquote opens search directly. Both `Finder` and `fangda` returned the actual 访达 下载 window. Evidence: `logs/updates-final-native-finder.json`. The public-release update round trip and interactive Windows behavior remain unverified.

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
- CI uses `macos-15` for Apple Silicon builds while retaining a macOS 14 deployment target. The previous `macos-14` runner is being retired; see [GitHub's retirement notice](https://github.blog/changelog/2026-10-01-github-actions-macos-14-runner-image-retirement/).

## Flexible hint characters and overview-only translucency (2026-10-29)

The shortcut settings now offer automatic short hints or Screen Buoy-style character rows for individual hint positions, with optional extra prefixes. Digits, punctuation (including Shift symbols) and spaces are supported by both native keyboard mappings; spaces display as ␣. Validation prevents duplicate characters, search/cycle-key conflicts, ambiguous prefixes and excessive combinations. Exhausted custom capacity leaves every window visible with search, arrow and click navigation available. Legacy alphabet-only settings and persisted assignments retain their previous codes.

The unlabeled alphabet keycap strip has been removed. Settings are opaque at both the native window and CSS layers. Only the shortcut-invoked overview receives native vibrancy/Acrylic; its background opacity also controls card surfaces while previews and hints stay clear. The saved local opacity is 26%.

Validation: 45 Rust tests and 26 browser interaction tests passed, including punctuation/space activation, persisted-hint migration, prefix-free custom expansion, overflow handling, per-position editing and transparency isolation. Production macOS app and Windows x64 executable builds succeeded. The installed Mac executable matches the built app (`acbdf9a22dc1d0261030ab2e813fe11d1ef70d423579594a5a099609b72808a6`); installation preserved settings after saving the user's pending 26% adjustment. Native permission/readback checks are recorded separately below. No release was created.

The follow-up documents forward/reverse cycling using the actual configured hold shortcut and explains Esc in both settings and the overview footer. An engine regression covers Alt, Ctrl, Super and multiple-modifier combinations, reverse invocation/cycling, Shift release, modifier release and cancellation returning to the original window. The footer wraps on small panels. All 46 Rust and 27 browser tests pass locally. The transparency test now explicitly exercises both reduced-transparency preferences instead of inheriting the macOS CI runner's opaque accessibility setting. The intermediate installed app's final native diagnostics confirmed all permissions and the hook ready, 24 windows, 20 cached previews, two displays and no warnings (`logs/charset-final-native-diagnostics.json`). A final build includes the additional keyboard help.

Final keyboard-help build: both release executables were rebuilt successfully. The installed Mac executable SHA-256 is `294857a3d4933e011c159dfb2a70ee5c43f26cce7a3230ba0e76b13698988538`, matching the built app, with all settings preserved. Source commit `efc5e0c2381006c3e5fa51435d85ce53d8149b23` passed both macOS and Windows CI, including native tests, browser tests and packaging: https://github.com/alvinfunborn/beaconhop/actions/runs/40811506077 .

Final-install native acceptance is pending the user's macOS Touch ID/system-password verification. System Settings shows its identity sheet while regranting BeaconHop Accessibility; no credentials were entered by automation. The earlier all-ready diagnostic applies to the intermediate installed binary, not this final keyboard-help build. Once identity verification completes, finish Accessibility/Screen Recording regrant, relaunch through LaunchServices, and reread native diagnostics before claiming final shortcut/preview acceptance. Windows interactive execution remains untested. No tag or release was created.


## Short hints with one character set (2026-10-29)

This supersedes the per-position configuration described above. Settings now contain one ordered character set, with no length mode, position rows or extra prefixes. Letters, digits, punctuation and spaces remain supported. Allocation uses single characters first and automatically expands only the least-preferred single-key branches when necessary, never exceeding two characters. Existing compatible assignments survive growth, reordering, closing windows and restarts; open overviews keep their current labels even if the next inventory needs expansion. Old unbounded/per-position caches migrate to the bounded pool, preserving compatible assignments. At N² capacity, excess windows remain visible and can be selected by search, arrows or click.

Local validation: 44 Rust tests and 27 browser tests passed, along with frontend production build, version consistency and formatting. Coverage includes every allocation boundary through the default 676-code capacity, prefix-free input, stable expansion, legacy cache migration, punctuation/space activation, overflow visibility and an inventory expansion while the overview is open. UI assertions verify that per-position, length and extra-prefix controls are absent. Evidence: `logs/short-hints-rust.log`, `logs/short-hints-ui.log` and `logs/short-hint-settings.png`. Final packaging, installation and CI evidence follows separately.

Source commit `a2533486c224d622cab467505aa0ef2585ce0855` passed both native-host CI jobs, including browser tests and packaging: [Check BeaconHop #40813853046](https://github.com/alvinfunborn/beaconhop/actions/runs/40813853046). Both local optimized executables also built successfully. The Mac executable installed at 11:53 on 2026-10-29 has SHA-256 `26adde0e44c8b4de9b956ea4bb3d21fc489dd986ed301ebc400c94ce13d826ec`; the Windows executable has SHA-256 `f44f4eab8aa3b73db900051e71f05231c8e60b1a40384f0e20ac49480777f28d`. Both embed the final frontend asset `index-AnS5-7jr.js`. Installation preserved all settings, including the user's Cmd+Tab hold shortcut and 26% panel opacity. Migration retained 24 of 25 previous window assignments; the migrated pool contained only single-character hints. The installed native settings page shows one character field and the two-character limit.

After replacing the ad-hoc Mac binary, Accessibility and the keyboard hook were restored through standard System Settings. Native diagnostics confirmed 26 windows across two displays. Screen Recording was then toggled and the app restarted through System Settings; final preview acceptance is recorded in the local handoff if available. The last diagnostic before that restart still had Screen Recording false and no cached previews, so that diagnostic does not prove thumbnail readiness. No credentials were entered by automation, no security database was edited, and no release or tag was created. Windows interactive acceptance remains untested. Evidence: `logs/short-hints-final-install.json`, `logs/short-hints-final-native-diagnostics.json`, `logs/short-hints-final-handoff.json`, `logs/short-hints-macos-build.log` and `logs/short-hints-windows-build.log`.

## 2026-11-02 — Optional browser tab previews

Implemented extension-owned, event-driven memory caches and asynchronous BeaconHop preview reads. Chromium capture is an opt-in `<all_urls>` permission in the extension popup. Only active, complete HTTP(S) tabs in a focused normal window are sampled; private/internal/file pages are omitted. Capture is debounced 800 ms, globally throttled to 1/s, with a 10-second same-page cooldown. JPEGs fit 320×180 and 60 KiB each; the LRU is bounded to 100 entries / 4 MiB encoded data. No periodic screenshots, disk cache, background tab activation or capture during list/activate RPCs. Navigation, moved/closed tabs, permission removal and asynchronous identity changes invalidate images. Background page navigation does not cancel another tab's pending capture.

Protocol 1 gained optional capabilities and item preview-availability flags. Legacy adapters remain compatible. Cached images are fetched separately in batches of eight, bound to endpoint epoch, context, item and URL. The tab UI starts reads after asynchronous inventory completion and reserves separate hint, preview and favicon columns. The BH thumbnail setting controls rendering; the browser popup switch also stops capture and clears/revokes permission.

Validation: 92 Rust tests passed (one pre-existing ignored test), six cache/race/budget tests passed, one actual native-host integration test passed, and six navigation Playwright tests passed. TypeScript/app build, `cargo fmt --check`, and whitespace checks passed. UI screenshot `logs/tab-previews-20261102/layout.png` was inspected. Final runtime formatting after the build changed whitespace only. Installed app SHA-256 is `434a3957b7e34d63e11fa5b3e81662837f871392807fcaf4f50c7c53bf0f6576`, with unchanged signing requirement and BH/SB settings. Screen Buoy was not replaced/restarted. The build lease was released.

The existing unpacked Edge extension was reloaded to 0.2.0, and its optional preview permission was enabled through its own button and Edge's permission dialog. A real Edge run on two temporary local fixture pages produced distinct JPEGs (3,875 / 3,855 encoded bytes), advertised both cache entries in inventory, rejected an old URL after navigation, and rejected a closed tab. Six two-image cache reads had median 33.57 ms (27.16–665.94 ms). These are small-fixture RPC timings, not end-to-end shortcut latency or CPU/RAM benchmarks; the long tail must not be hidden by the median. The first attempt missed a capture without sufficient focus evidence. After the background-invalidation fix/reload, a further run observed the fixture window explicitly unfocused and correctly returned no image; it did not complete a second positive run of that last extension revision. All owned windows and temporary servers were closed. No physical Ctrl+Tab or Windows runtime acceptance is claimed.

The existing VS Code adapter was packaged with the official `vsce` tool as `logs/tab-previews-20261102/beaconhop-tabs-0.1.0.vsix` (six files, 4.72 KiB). Its previous real VS Code enumeration/group activation/closed-target/auth test result was verified at `logs/vscode-plugin-qa/plugins/integration-result.txt`; it was not rerun in this iteration. The ordinary VS Code extension list did not contain BeaconHop; no installation into the user's VS Code profile was performed. Plugin discovery/protocol/mounting instructions and current SDK/installer/catalog limitations are documented in `plugins/README.md`.

## 2026-11-02 — Plugin SDK and dynamic manager

- Added dependency-free Node SDK, TypeScript definitions, manifest schema, scaffold, import/check/probe tools, VSIX installation and browser registration. VS Code 0.2.0 bundles the shared SDK. Settings lists registered/live third-party providers and preserves opt-out across reconnect/reimport. Generic cached thumbnails and inline icons use the existing bounded protocol.
- Validation: 95 Rust tests passed (1 opt-in Codex test ignored); 8 targeted Playwright tests passed; 6 SDK protocol tests, 7 browser/native-host/cache tests and 2 SDK-to-native-manager integration tests passed. Windows cross-check passed with the repository's `.tools/bin/cargo-windows`; Windows runtime and registry installation remain untested.
- Packaged VSIX was installed with the new installer into an isolated extension directory. A real VS Code extension host passed enumeration, exact cross-group activation, closed-target rejection, authentication and awaited discovery cleanup. Test application processes were independently checked absent. The SDK tarball was installed into a separate consumer directory, and its installed CLI generated and validated a scaffold.
- Updated `/Applications/BeaconHop.app` with the existing designated signing requirement; BH/SB settings hashes were preserved. Installed binary SHA-256: `3fca141cf5b585d8b94c94fc21aeb5fa3a0f0676bb2c4a1d78b292d5b4f762de`. Screen Buoy was not replaced. VS Code 0.2.0 was installed into the normal extension directory; eight application instances connected automatically and answered read-only inventory probes. No user editor was selected for this production-profile readback.
- Local deliverables and receipts: `logs/plugin-kit-20261102/` (SDK tarball, VSIX, installed status, package hashes, build/test logs, native install receipt and isolated host cleanup). No npm, VS Code Marketplace or browser-store publication. Shared build leases were released; no queued follow-up remains.


## 2026-11-02 — Ctrl+Tab thumbnail grid

CT now shares WT thumbnail cards, small title/favicon metadata, hint styling and geometry-based four-direction navigation. The native panel also uses grid sizing. Large tab inventories scroll rather than shrinking preview cards; search, Tab/Shift+Tab and selected-item visibility remain supported. Explicit list mode remains available.

Validation: 34 navigation/interface Playwright tests passed, including asynchronous cached images, missing/disabled thumbnails, multiple columns, arrows after filtering/resizing and 150-target scrolling. Rust checks passed (99 passed, one opt-in test ignored), including held Ctrl+arrow selection and release-to-activate. Frontend production build and app packaging passed. Screenshot inspected: `logs/tab-grid-20261102/layout.png`.

Updated `/Applications/BeaconHop.app` and verified the installed binary hash `b23e6620e5eafafc615ce531f0e9e9edfe3aef012cd12aab153c244f7f973fdc`, unchanged designated signing requirement, preserved BH/SB settings and running BeaconHop. Screen Buoy PID remained unchanged. Receipts and logs: `logs/tab-grid-20261102/`. Physical shortcut replay and Windows runtime acceptance were not performed in this iteration.


## 2026-11-02 — in-app plugin installation

BeaconHop now has a dedicated Application plugins page and a setup entry on the Shortcuts home page. VS Code installation uses a bundled VSIX and the detected editor's own CLI; the backend verifies payload SHA-256, retains a newer installed version, reads back installation, bounds process runtime and prevents concurrent installation. Installation and live connection remain separate states. The Edge path registers the per-user bridge before opening the configured official listing, supports repair, and refreshes previously authorized registrations after a packaged BH update. No extension ID is needed in the normal end-user flow.

Evidence is in `logs/plugin-onboarding-20261102/`:

- Rust suite: **99 passed, 2 ignored**. The explicitly selected real VS Code installer test then passed: installed the bundled VSIX into an isolated profile, read back the version, repeated installation, and removed the profile. The other ignored native permission test was not run.
- UI suite: **49/50 passed on the first run**; one new test's connection fixture failed to inject into Vite-transformed code. Fixed the fixture and reran all four installer tests: **4/4 passed**, covering the remaining case, with no application logic change needed. All 50 UI cases therefore passed across those runs. Chinese, small-window and native UI screenshots were inspected.
- SDK **6/6**, packaged payload validation **2/2**, release-binary browser/cache/native manager checks **9/9** passed. Browser store ZIP includes popup styles and all declared runtime assets. Public-release gating correctly rejects the current null Edge listing.
- Windows MSVC cross-check passed. **No Windows installer/UI acceptance was performed.**
- Built the macOS app, checked its embedded VSIX hash and Edge ZIP, signed with the existing local signing identity and installed at `/Applications/BeaconHop.app`. Installed executable SHA-256: `f7ca0ad304d0c233f0ae7d75e666e374d3a0a521ae3d920d1afa096deb9d64c4`. Signing requirement and both BH/SB configuration hashes were preserved; no public release or notarization occurred.
- In the installed native UI, clicked Application plugins, Check / update extension and Repair connection. Observed both VS Code version-query processes and independently read back the rewritten Edge host path. **1 Edge connection and 8 VS Code instances remained connected.** User focus and pointer were restored; Screen Buoy PID stayed unchanged. The ordinary VS Code adapter was already 0.2.0, so the native UI correctly retained that version; fresh installation was proved by the isolated test above.
- Test processes exited, temporary editor profile was removed, Playwright's server stopped, and host-heavy lease `ad50d8b5768fe3ae6047` was released. The updated normal BH app remains running intentionally.

**Remaining distribution dependency:** `plugins/distribution.json` has no official Edge Add-ons ID/URL. The installation UI correctly reports store installation unavailable for a new user. `src-tauri/resources/plugins/beaconhop-edge.zip`, `plugins/browser/STORE.md` and `plugins/browser/PRIVACY.md` are ready for the project owner's publication workflow; store account/listing assets/privacy URL and actual certification are still required. Store-backed clean-profile installation cannot be accepted until that listing exists. Existing unpacked Edge integration was retained and was not reloaded into its new popup version during this task. VS Code Marketplace/npm publication is not required by the bundled installation flow and was not performed.

## 2026-11-03 — selected-window activation on macOS

Fixed native activation promoting sibling windows along with the selected window.
The original bridge reproduced `[cover, sibling, other, target]` becoming
`[target, sibling, cover, other]`, despite reporting the correct focused window.
Receipt: `logs/single-window-20261103/baseline.json`.

The bridge now restores a hidden application with `AXHidden = false` before
activating it, selects and raises the target, and uses Process Manager's public
`kSetFrontProcessFrontWindowOnly` option. It raises the target again after
activation for applications that defer the first raise. It no longer calls
application-wide `unhide`, AppKit activation or AX frontmost writes in this path.
The legacy C APIs use explicit ABI declarations because Swift does not expose
them as callable declarations. Exact PID/window-ID confirmation and rejection of
closed targets remain in place.

Hidden restoration waits an additional 300 ms after visibility is confirmed:
AppKit can still deliver queued key-window notifications after `AXHidden` clears.
Without that settling interval, the window order was correct but the focused
window later became nil (`logs/single-window-20261103/hidden-focus-race.json`).
This delay applies only to hidden applications.

Native acceptance: **5/5 passed** using the actual bridge with two disposable
applications and four windows. Background, already active and minimized targets
all retained the relative order of unselected windows and focused the exact
selected ID. A hidden application retained that order after restoration and
focused the target. A closed target correctly returned an error. Test fixtures
were stopped and the original focus restored. Receipts:
`logs/single-window-20261103/native-acceptance.json` and `acceptance-source.json`.
The opt-in harness is in `scripts/macos-window-focus/`; it refreshes inventory
before activation, matching BH's live-window flow.

The release app built successfully from the accepted native source. Signed with
the existing local signing identity and installed at `/Applications/BeaconHop.app`;
its designated signing requirement is unchanged. Installed executable SHA-256:
`aa08cf5c925cc19ee2d953d525e96a8dfd959b76e7281e444f1252361208a411`.
Independent readback verified the installed hash and signature, running BeaconHop,
unchanged BH/SB configuration hashes and unchanged Screen Buoy PID 79993. The old
app and configuration backups remain under `logs/single-window-20261103/backup/`.
Build/install receipts: `build-final.json`, `install.json` and
`installed-readback.json` in that evidence directory.

Owned fixture/driver processes exited and host-heavy lease
`a8cc0a70a46164120fc6` was released. The updated normal BH app remains running.
No public release or notarization occurred. Windows, fullscreen/cross-Space
behavior and physical shortcut replay were not accepted in this iteration.

## 2026-11-03 — Codex Ctrl+Tab inventory deadline

Codex inventory used the default `thread/list` path, which scans historical
rollouts to repair metadata. With the installed CLI 0.166.0-alpha.5.1 and the
running BH's inherited `CODEX_HOME`, initialization and listing took 11.23
seconds, exceeding BH's eight-second deadline. Inventory now requests the
existing state index (`useStateDbOnly`), explicitly includes CLI, VS Code and
desktop app-server sources, and includes all configured model providers. EOF and
timeout now produce distinct errors. A successful read logs count and elapsed
time without session titles or contents.

Real metadata-only probes returned 100 sessions: initialization/list took
0.928/0.237 seconds for the inherited data directory and 1.624/0.321 seconds for
the default directory. These are API timings, not physical shortcut acceptance.
Protocol regressions cover request parameters, notifications and bounded child
cleanup on timeout. All **104 Rust tests passed**, including the installed
Codex CLI and isolated real VSIX installation. TypeScript, Vite and the release
app build passed. Evidence: `logs/ct-codex-20261103/`.

The VS Code adapter does not rewrite editor keybindings: BH's system keyboard
hook consumes the shortcut before the editor. Added coverage passed for
Ctrl+Tab, Ctrl+Shift+Tab, down/up/repeat, loading and cancellation, with later
ordinary keys passed through. Eight VS Code 0.2.0 instances were connected.
The user's native conflict was not reproduced: guarded shortcut probes were
aborted when focus changed during a concurrent Screen Buoy native test. No
VS Code functional shortcut change or physical acceptance is claimed.

Signed and installed the release app at `/Applications/BeaconHop.app` with the
existing designated signing requirement. Independent readback verified SHA-256
`6c9ea33bc5f2d1ce0496afa5ea174eee32690cd55c159f80ef7976d98d301db3`,
the signature, unchanged BH/SB configuration hashes, running BH PID 79570 and
unchanged Screen Buoy PID 79993. The keyboard tap installed successfully; one
Edge and eight VS Code connections remained online. The old app/config backups
and installation receipts remain in the evidence directory. The heavy build
lease was released; no owned lease/request remains. No public release,
notarization, native Windows or physical Codex Ctrl+Tab acceptance occurred.


## 2026-11-03 — content-specific presentation

Added a shared content presentation model: an optional plugin-context
`presentation` selects `text` or `thumbnails`, carried on each content target.
Legacy endpoints with thumbnail capability default to thumbnails; other legacy
endpoints default to text. The frontend has no provider-name rendering branches.
Browser cards keep their grid even when an individual image is missing. Codex
and VS Code use readable single-column rows, separate hint/icon columns and
scrolling. Explicit user list layout still overrides a thumbnail preference.
Window/application/desktop layouts retain their existing behavior.

Text targets do not render missing-preview placeholders or request images.
Native panel sizing follows the same row heights rather than native-parent image
aspect ratios. An optional bounded `description` is rendered beneath the subtitle
and included in search. Codex uses persisted preview metadata only when distinct
from its title, without loading a conversation or generating summaries. Existing
VS Code 0.2.0 connections gain text presentation through capability fallback,
without editor reload or keybinding changes. The SDK types, validation and
protocol documentation expose the same additive fields to external adapters.

Validation: **106 Rust tests passed**, including the installed Codex CLI and
isolated VSIX installer; **7 SDK tests passed**; **39 Playwright tests passed**.
Coverage includes explicit/legacy presentation defaults, invalid presentation and
oversized descriptions, no text image reads, duplicate-name path distinction,
summary search, hint/icon separation, arrows/activation, 150-target scrolling,
browser grid and list override, and existing window/desktop navigation. Codex
and VS Code fixture screenshots were inspected. TypeScript/Vite production
build passed. Evidence is in `logs/content-presentation-20261103/`.

Built, signed with the existing designated requirement and installed at
`/Applications/BeaconHop.app`. Independent readback verified executable SHA-256
`1cd6ba961aff4f9d3fef87bcf888544f6897cf6a62d439e12fbb9ff15c88cca8`,
the signature, running BH, unchanged BH/SB configuration hashes and unchanged
Screen Buoy PID during installation. One Edge and eight VS Code 0.2.0 connections
remained online; the keyboard tap installed successfully. The old app and config
backups and receipts remain in the evidence directory. No owned build lease,
queued request or Playwright server remains. This iteration verified fixture
rendering and installation; physical global shortcut/GUI content activation and
Windows runtime were not replayed. No public release or notarization occurred.
