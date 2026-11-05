<p align="center"><img src="public/beaconhop.svg" width="112" alt="BeaconHop logo" /></p>
<h1 align="center">BeaconHop</h1>
<p align="center">Follow the hint. Make the hop.</p>

BeaconHop is a desktop, window and in-app content navigator for macOS and Windows, adapted from [Screen Buoy](https://github.com/alvinfunborn/screen-buoy). It brings open windows into view with stable letter hints, previews and title/application search. Localized apps can also be found by their bundle ID or executable name: `Finder` finds 访达 on a Chinese Mac.

## Interaction

- **Win + Tab**: all windows. **Alt + Tab**: windows of the focused application. **Ctrl + Tab**: tabs in the focused window. **Ctrl + Win + Tab**: desktops, including empty ones. Win means Command on macOS. Hold the modifiers, cycle with Tab / Shift + Tab and release to select. Use the same modifiers with backquote to search. Each binding is configurable. Applications without a connected tab adapter keep their native Ctrl + Tab.
- **Type a complete hint while holding**: immediately activate that exact window. Hints follow native window identity and stay stable through sorting, filtering and BeaconHop restarts. Closed/recreated windows receive a new allocation.
- **Backquote (\`) while holding**: enter persistent search; you can release the modifier. This key is configurable separately from the global shortcuts.
- **Keep holding the last hint key**, then press **Win / Alt / Ctrl** and release the gesture to continue to windows / application windows / tabs. Either **HintLeftKey / HintRightKey** enters Screen Buoy on key press: desktop hints open desktop-scoped SB (including empty desktops); window, application-window and tab hints open window-scoped SB. Each action supports multiple alternative keys; SB integration must be enabled separately.
- Search accepts Chinese text, full pinyin, initials, common polyphonic readings and mixed Chinese/Latin terms; Latin accents and full-width letters are normalized. For example, `weixin` / `wx` match 微信, and `chongqing` matches 重庆. Chinese IME composition confirms text before Enter can switch windows.
- All four arrow keys navigate by the visible card positions in both hold and search modes. Win + Tab initially selects the most recently used other window; further Tab / Shift + Tab follow stable preview order across displays. Escape cancels. Click a card to switch. Minimized windows are restored.

All layer shortcuts and the hold-to-search key are configurable. Adding Shift to the configured hold shortcut reverses cycling, including custom Control, Command/Windows and multiple-modifier combinations (for example, Ctrl + Space / Ctrl + Shift + Space). Releasing Shift alone keeps the overview open; releasing a configured hold modifier commits the selection. Esc cancels and returns to the original window in both hold and search modes. The settings description and overview footer follow the configured keys. Desktop and display scopes are independent. Cross-desktop navigation follows a window to its existing desktop; it never moves the window.

## Status and systems

Hints use one ordered character set supporting English letters, digits, punctuation and spaces (shown as ␣). Single-character hints are used first; when needed, the least-preferred single keys automatically expand into two-character combinations. Hints never exceed two characters, and there are no length, per-position or extra-prefix settings. Earlier characters are preferred. Existing assignments are retained whenever they remain valid; expansion only reassigns windows whose single key becomes a two-key prefix, and never changes hints during an open overview. Closing windows does not reshuffle familiar codes. With N characters, at most N² windows can have distinct hints (676 with the default 26 letters); excess windows stay visible and selectable by search, arrows or click. Search/cycle keys cannot overlap hint keys. Symbols use English physical keyboard positions with Shift for shifted punctuation. Old caches migrate to the two-character limit while retaining compatible assignments.

Win + Tab opens an overview on each display in scope. Each uses its whole canvas for complete window previews, positioned near their original desktop locations and separated to expose every window. One common scale per display preserves the native width and height ratios across desktops, with a separate title strip. Packing compares free-rectangle edge/contact fits and compacts both axes to fill holes and enlarge previews. Desktop order constrains group centers; individual cards can fill neighbouring gaps without fixed quadrants. Windows share a compact layout with soft desktop gradients and relative positions in native Space order, including full-screen Spaces. Placement guides account for total native window area; desktops do not reserve fixed columns. Empty inactive desktops are skipped, the current desktop stays marked, and unknown ownership has a separate final group. Opening animates from the native stack; the Original stack control returns to the original positions within each desktop, with confirmed front-to-back order for visible windows. Hovering or selecting shows the original footprint. Hidden, minimized and other-desktop windows receive complete previews without implying that they are visible on the desktop. Selection and filtering preserve the expanded positions. Search inputs on every display mirror edits, including IME composition, while filtering waits for composition to finish. Global hints stay stable. The application-window overview retains its adaptive layout. The shortcut-invoked overview uses native macOS vibrancy / Windows Acrylic. Its background-opacity slider controls the tint across the overview and card backgrounds; thumbnails, text and hints stay clear. Settings remain opaque. System Reduce Transparency may override native translucency. In the spatial overview, the selected window has a larger light hint with dark text and a small downward pointer; the departure window has an ordinary-sized teal circular hint. A window in both states adds a teal dot to the selected sign. Selection pops briefly once, settles directly during rapid cycling, and respects Reduce Motion. These central state markers remain visible during search. Centered hint badges support font size/weight, text and background colors, background opacity, corners, borders and shadows, with light/dark previews and reset. Search keeps the current panel size to avoid movement while typing. Tab and desktop layers use readable scrolling rows instead of window previews.

macOS captures previews in bounded parallel batches using one shareable-window query, decodes them before publishing a batch, and reuses an in-memory cache. It warms the initial inventory and refreshes the foreground window after focus changes. Settings includes a persistent restart button; save or discard edits before restarting.

Version 0.1.0 has local macOS app/DMG and Windows EXE/NSIS builds. macOS native validation includes 100 repeated round trips, two displays, multiple Spaces, same-title windows, closed targets and WeType Chinese input; Windows runtime acceptance is pending an accessible test machine. These are development distributions: macOS is ad-hoc signed and not notarized; Windows is unsigned. See [validation](docs/validation.md) for the evidence and remaining checks.

- macOS 14+ (Apple Silicon built locally; Intel remains unverified). Accessibility enables enumeration/focus and normally the keyboard hook; Input Monitoring is a troubleshooting option when the hook remains unavailable. Screen Recording enables previews.
- Windows 11 24H2, build 26100.2605+, is the initial cross-desktop target of the pinned `winvd` adapter. Other Windows versions must be verified before expanding support. Public desktop membership and ordinary window switching are separate from the version-sensitive desktop switching API.
- Windows DWM renders live previews, with title/application placeholders for unavailable or protected windows. macOS uses ScreenCaptureKit.
- System security screens, other users' sessions, and protected/elevated windows that deny focus are outside guaranteed control.

On macOS, missing Accessibility opens the permission setup in the foreground at startup, including background launches. Other settings pages keep a visible access banner. Shortcut configuration can still be entered manually and saved before granting access.

Window metadata, settings and previews are processed locally. Stable hint assignments are saved locally in `hints.json`, keyed by native window identity; closed-window mappings are pruned. Window preview slots are saved separately in `overview.json`, also using native identity. Preview pixels are cached only in memory. No analytics, network search, or screenshot upload is included.

## Development

Prerequisites: Node.js 22+, stable Rust, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). macOS additionally requires full Xcode with the Swift compiler and a macOS 14+ SDK. Windows requires Visual Studio C++ build tools and WebView2.

```sh
npm ci
npm run tauri:dev
```

```sh
npm run build
npm test
npx playwright install chromium
npm run test:ui
npm run check:version
npm run tauri -- build
```

For UI-only preview, run `npm run dev` and open `http://127.0.0.1:1437/?preview=1`; the switcher is at `/?preview=1&view=switcher`. Preview mode exists only in the development server and uses labeled fixtures. It does not control real windows.

The project keeps its own application identity (`com.beaconhop.app`) and configuration, separate from Screen Buoy. Set `BEACONHOP_DATA_DIR` to an isolated directory for native tests. Settings can be inspected in the app's System & access → Diagnostics section.

The [branding guide](docs/branding.md) describes the window-stack logo and `npm run icons` asset generation.

## Architecture

- `src-tauri/src/engine.rs`: platform-independent selection, stable hints, MRU, scopes, key release ownership, and search.
- `src-tauri/src/plugins.rs` and `plugins/`: authenticated local adapters for in-app targets. `codex_plugin.rs` provides the limited built-in Codex adapter.
- `src-tauri/src/input/`: dedicated native keyboard hook threads. They enqueue actions, without enumeration or screenshot work.
- `src-tauri/src/platform/`: OS adapters and exact foreground validation.
- `src-tauri/native/BeaconBridge.swift`: macOS Accessibility, Space membership, ScreenCaptureKit, and panel bridge.
- `src-tauri/src/runtime.rs`: asynchronous inventory, presentation, activation, settings, and bounded preview cache.
- `src/`: shared settings and switcher UI, English / 简体中文, dark / light themes.

The product abstraction is **visual navigation**: quickly reaching the desktop, window or content you want. The new four-layer development implementation includes Chrome / Edge and VS Code plugins plus a macOS Codex session adapter. See [navigation and current limitations](docs/navigation.md) and [plugin setup / protocol](plugins/README.md). Codex lists recent persisted sessions, not GUI tabs, and cannot confirm GUI selection or automatically continue to SB. Native desktop switching and the complete new gesture chain still need installed-app acceptance; earlier window tests do not establish that. Saved-session restoration, remote sessions, gaze input and cross-device navigation remain future work.

## License and attribution

MIT. Original Screen Buoy copyright is preserved in [LICENSE](LICENSE). This fork began at Screen Buoy commit `045a5f0`; upstream remains read-only, with pushes disabled. The companion Screen Buoy is maintained and released separately in its own repository. BeaconHop branding, interaction engine, window adapters and interface are maintained independently.

## Updates

System settings includes manual update checks, signed downloads, progress, installation and restart. Network failures and unavailable/private release sources have separate messages and never claim the app is up to date. Updates preserve settings. See [update setup](docs/updates.md) for signing and publication configuration. No release is created by ordinary pushes or by the default package workflow.

第三方应用适配器可使用 [插件 SDK 与接入工具](plugins/sdk/README.md)，无需修改 BeaconHop 本体。

在 BH 设置 → **应用插件** 中安装和连接应用。VS Code 扩展随 BH 打包，一键安装到默认配置文件；Edge 使用商店确认 + 自动连接流程，目前仍待商店上架。开发者发布步骤见 [Edge 上架说明](plugins/browser/STORE.md)。
