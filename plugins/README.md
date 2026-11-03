# BeaconHop application plugins

The core owns shortcuts, hints, search, native window focus and Screen Buoy handoff. A plugin lists targets in its focused application context and activates an exact target. The adapters are local development packages, not marketplace releases. See [navigation](../docs/navigation.md) for supported features and acceptance boundaries.

## End-user installation

Open **BeaconHop → Application plugins** (also linked from the Shortcuts home page).

- **VS Code:** click **One-click install**. BH detects standard user/system installations on macOS and Windows, falling back to Insiders when stable is absent. It verifies the bundled VSIX, invokes the application's own CLI without requiring Node on PATH, preserves newer versions, and reads back the installed version. The default profile is targeted. Enable the extension in other profiles as needed. Installation and live connection are shown separately; a window reload may be needed and is never forced.
- **Edge:** once the official store listing is configured, click **Install and connect**, confirm **Add extension** in Edge, and wait for Connected. BH registers its bridge automatically, using its installed executable path; no copied ID or shell command is needed. Previously registered Edge connections are repaired at packaged-app startup and via **Repair connection**. The listing has not been published yet, so clean-user store installation remains unavailable. See [publication checklist](browser/STORE.md) and [privacy notice](browser/PRIVACY.md).
- Plugin opt-out is preserved during installation and reconnection. Check the **Plugin connections** switches if navigation remains disabled.

`npm run build` and `npm run dev` generate the first-party payloads automatically (build machines require Node 22+). `npm run plugins:bundle` also generates them independently. Tauri embeds the VSIX, Edge submission ZIP and payload metadata in its resource directory; end users do not need this repository. CI validates payload contents and keeps store publication separate from local builds.

## Browser development: Chrome / Edge

1. Build the current BeaconHop source (`npm run build`, then `cargo build --manifest-path src-tauri/Cargo.toml`) or use an app built from it. An older installed BeaconHop binary will not understand native-host requests.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, and load `plugins/browser` as an unpacked extension. Copy the extension ID.
3. Register the native host, replacing both arguments below. Registration writes only that browser's per-user native-host manifest (and HKCU registry entry on Windows):

```sh
node scripts/install-browser-host.mjs chrome EXTENSION_ID /absolute/path/to/beaconhop
```

For a packaged macOS app, the executable is `/Applications/BeaconHop.app/Contents/MacOS/beaconhop`. For a local debug build, use the absolute `src-tauri/target/debug/beaconhop` path. On Windows, pass `beaconhop.exe`. Use `edge` for Edge. The script also has Chromium/Brave paths, but those browsers have not been accepted in this iteration.

4. Open the browser's BeaconHop extension popup and click **Reconnect**. In BeaconHop → Application plugins, Browser should become available. Focus a normal browser window, then use Ctrl + Tab or Ctrl + backquote.

Each browser profile must load the extension. It only exposes tabs allowed by that profile's extension permissions. It requests `tabs`, `nativeMessaging`, `alarms` and `favicon`. There are no content scripts. The optional **Enable previews** button requests `<all_urls>` because Chromium requires it for automatic visible-tab capture; basic switching works without that permission. Website icons are read from the browser's local `_favicon` resource and sent as small inline PNGs; no remote image URLs are loaded by BeaconHop. URLs, titles, icons and previews stay on this computer. Reload the unpacked extension after updating its source or manifest. Removing the extension disconnects the host; stale discovery entries expire in 20 seconds. Re-register after moving the executable.

The tab list reserves a separate column for hints. Missing icons use the page title's initial. Icon reads time out after 500 ms and are limited to 64 tabs in the focused window per inventory to bound response size; failure to read an icon does not prevent switching. Optional tab previews are captured only after an active HTTP(S) page finishes loading, becomes active or its normal browser window gains focus. Enable them in the extension popup, then visit the pages you want cached. Private tabs and internal/file pages are excluded. Previously unvisited pages show “No preview”; no background tab is activated to take a screenshot.

Captures debounce for 800 ms, run at most once per second globally, and reuse a same-page capture for 10 seconds. JPEG images are resized to fit 320×180, at most 60 KiB each. The memory-only LRU holds at most 100 images and 4 MiB of encoded image data (this is not a bound on total browser RAM or temporary decoding buffers). There is no periodic screenshot timer or disk persistence. Navigation, close, detach, permission removal and in-flight identity changes invalidate images. Disabling previews in the popup revokes the optional permission and clears the cache. BeaconHop's thumbnail setting controls display; use the extension switch to stop capture.

Ctrl+Tab reads inventory first, then fetches cached previews in batches of eight. No screenshots or image bytes are on the inventory/activation path. Thumbnail failure leaves switching available. Hints, previews and favicons have separate columns. Reload the extension after updating it; an older native host must also be replaced before this capability can be used.

If Ctrl + Tab still uses the browser's built-in switcher, check that both the extension and native host are installed in the current browser/profile. The app provides installation setup; the browser still requires its own extension confirmation. A `!` badge on the extension means its host is unavailable; after registering the host, open its popup and click **Reconnect**. On macOS, also check keyboard remapping rules that intercept Control + Tab, including rules that allow additional modifiers. Test from a normal browser window: standalone web-app windows are outside this adapter's inventory.

## VS Code

Launch an isolated development host without changing your normal profile:

```sh
npm run plugins:prepare
code --extensionDevelopmentPath="/absolute/path/to/beaconhop/plugins/vscode" \
  --user-data-dir="/absolute/path/to/isolated-vscode-data" \
  --extensions-dir="/absolute/path/to/isolated-vscode-extensions"
```

Open text, diff or notebook editors in that window. The plugin runs in the local UI extension host, including when the workspace is remote. Terminals, webviews and custom editors are omitted. The identity is the actual VS Code `Tab` object and editor group, so duplicate labels do not collide.

For normal use, install from BH → Application plugins. For manual distribution, package with the official VS Code extension packager from `plugins/vscode`, then use Extensions → Install from VSIX. Install only the desired profile; BeaconHop availability requires that window's extension host to be running.

```sh
npm exec --yes --package=@vscode/vsce -- vsce package --allow-missing-repository
code --install-extension /absolute/path/to/beaconhop-tabs-0.2.0.vsix
```

## Codex

The initial macOS adapter is built into BeaconHop; no extension installation is required. It detects the Codex app's bundled CLI. `BEACONHOP_CODEX_BIN` can override the executable for development. The optional Codex data folder setting chooses the app-server's `CODEX_HOME`; it must correspond to the running GUI's data. Only the recent 100 persisted, unarchived sessions are listed. Listing uses the existing state database (`useStateDbOnly`) without scanning historical rollout files, and includes CLI, VS Code and desktop app-server sources across providers. It has an eight-second deadline. GUI tab enumeration and exact GUI activation confirmation are unavailable, so automatic continuation is disabled after a Codex session request.

## Protocol 1

### Content presentation

The core shares hint assignment, search, selection, navigation and activation
across content types. Each inventory context may declare
`"presentation":"text"` or `"presentation":"thumbnails"`. The default for
an older plugin is thumbnails when its endpoint advertises the `thumbnails`
capability, otherwise text. Presentation does not depend on provider names or
whether an individual item currently has an image. Explicit list layout remains
a user override for thumbnail providers; the thumbnail display switch does not
change presentation semantics.

Browser contexts therefore retain thumbnail cards, including an unavailable-image
placeholder. Codex sessions and VS Code editors use a readable, scrolling single
column with separate hint/icon columns, title and path/context. No image RPCs or
missing-preview placeholders are used for text. Items may add a bounded optional
`description` (up to 8 KiB UTF-8), rendered beneath the subtitle and included in
search. Codex uses its persisted preview as a description only when it differs
from the title; no session contents are loaded to generate a summary. Existing
VS Code adapters work without reinstallation or editor keybinding changes.

Plugins publish discovery JSON under `~/.beaconhop/plugins` (`%USERPROFILE%\.beaconhop\plugins` on Windows). `BEACONHOP_PLUGIN_DIR` overrides it for isolated tests; all participating processes must use the same directory. The core does no discovery or socket work inside the keyboard hook.

```json
{
  "protocol": 1,
  "provider": "example",
  "instance": "new-random-uuid-on-every-start",
  "appIds": ["com.example.app", "example.exe"],
  "capabilities": [],
  "port": 49152,
  "token": "random-secret-at-least-32-characters"
}
```

Listen only on `127.0.0.1`, ask the OS for an available port, refresh the file every 5 seconds, and delete it when stopping. Unix discovery directories/files use 0700/0600. Port 49152 above is illustrative, not a configured service port. Reject missing/wrong protocol or token. Limit newline-delimited UTF-8 JSON to 1 MiB; one request and response per TCP connection. Never include the token in logs or UI. This protocol trusts local same-user plugins, not arbitrary web pages.

Request:

```json
{"protocol":1,"id":"request-uuid","token":"discovery-token","method":"list","params":{}}
```

Response:

```json
{"id":"request-uuid","result":{"contexts":[{"id":"native-context-id","focused":true,"items":[{"id":"stable-item-id","title":"Tab title","subtitle":"URL or path","active":true}]}]}}
```

List all live contexts owned by this plugin instance. Only one matching context across all matching instances may report `focused:true`; zero or multiple causes an explicit error. Return at most 256 contexts and 2,000 items per context. Item IDs must be unique within their context. Exactly one active item is expected where the app exposes it; otherwise return all `active:false`. No background focus changes are allowed during `list`.

Plugin items may include optional `icon` containing a `data:image/png;base64,` image of at most 8 KiB including the prefix. Missing, oversized or remote icons are discarded. Keep the complete response within the 1 MiB framing limit.

Activation request and success:

```json
{"protocol":1,"id":"request-uuid","token":"discovery-token","method":"activate","params":{"context":"native-context-id","item":"stable-item-id"}}
{"id":"request-uuid","result":{"context":"native-context-id","item":"stable-item-id","verified":true}}
```

Read back the exact selected item before returning `verified:true`. A moved, closed or replaced item must fail, not silently open a similarly named one. Errors use `{"id":"request-uuid","error":"Actionable error"}`. The core also validates the captured native parent window before and after activation. It rejects endpoint epochs that have disappeared, and stale navigation responses.

### Optional cached thumbnails

Advertise `"capabilities":["thumbnails"]` in discovery (or the browser hello), and `"preview":true` on inventory items with a cached image. Absent capabilities/flags are compatible with older plugins. The core currently reads at most 100 advertised images per invocation, in batches of eight. Preview availability is independent of activation support.

```json
{"protocol":1,"id":"request-uuid","token":"discovery-token","method":"thumbnails","params":{"context":"10","items":[{"id":"1","url":"https://example.test/"}]}}
{"id":"request-uuid","result":{"context":"10","items":[{"id":"1","url":"https://example.test/","image":"data:image/jpeg;base64,..."}]}}
```

Here `url` must equal the inventory subtitle. Validate context, item and current URL before returning a cached image, including after async work. Return an empty list for unavailable images; never focus or capture a page during this RPC. At most eight images, each at most 60 KiB of inline JPEG data including its prefix. The core rejects mismatched context/ID/URL, remote images and oversized data. Failure is optional and must not break listing or activation.

### Third-party mounting

A target application's installed adapter starts its own local endpoint and publishes discovery. BeaconHop discovers it automatically without a core rebuild or restart. Provider/instance/context/item form the identity, so independent application windows and restarted plugin processes do not collide. Implement `list` and verified `activate` first; capabilities such as thumbnails are optional. Use the VS Code adapter as a working external-process example and the browser adapter for Native Messaging.

The shared [SDK and template](sdk/README.md) implement the protocol and registry lifecycle. The settings page lists all discovered or registered providers, including offline records, and supports persistent enable/disable. The CLI scaffolds adapters, validates/imports metadata, installs VSIX packages through the official VS Code CLI, registers browser hosts, and performs read-only connection checks. Distribute adapters in their host application's extension format; registering metadata alone never starts code. There is no published marketplace, signed catalog, upgrade service or plugin sandbox. Test duplicate titles, multiple windows, restart, moved/closed targets, authentication failures and focus confirmation in the actual application.


The browser host wraps this protocol in Chrome Native Messaging's 4-byte little-endian frame length. Its first message is `{"type":"hello","appIds":[...],"capabilities":["thumbnails"]}`. Browser extensions never receive the local discovery token; the host authenticates and strips it before forwarding requests.

## Verification commands

From the repository root:

```sh
npm test
npm run test:ui
npm run test:browser
npm run test:plugins
npm run test:plugin-manager
cargo test --manifest-path src-tauri/Cargo.toml --lib installed_app_server_lists_local_metadata -- --ignored --nocapture
```

The last command reads local Codex session metadata and prints only counts. For the real VS Code integration test, add `--extensionTestsPath=/absolute/path/to/beaconhop/plugins/vscode/test/integration.cjs` to the isolated development-host command and set `BEACONHOP_PLUGIN_DIR` to an isolated absolute directory. It creates and cleans its own test editors, then the development host exits. `integration-result.txt` records the result without tokens or document contents.

API references: [Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [VS Code API](https://code.visualstudio.com/api/references/vscode-api), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Codex deep links](https://learn.chatgpt.com/docs/app/commands#deep-links).

## SDK 与第三方接入（2026-11-02）

[SDK 使用说明](sdk/README.md)与 [manifest schema](sdk/manifest.schema.json)提供可分发的 Node 适配器模板、类型及工具。SDK 封装鉴权、连接身份、心跳、消息大小限制和清理；作者实现 `list`、`activate`，可选实现缓存缩略图。VS Code 0.2.0 已使用同一份 SDK。浏览器仍使用扩展 + 本体 Native Messaging host；无需在 service worker 中运行 Node。

BH 设置的应用插件列表根据连接及注册信息动态生成，显示名称、版本、实例数与可用状态，支持立即启停。安装应用扩展后启动宿主即可自动接入；无需重编译 BH 或手填端口。已注册但离线的第三方记录可以移除，用户停用状态不会因重连或重新导入而消失。导入 `beaconhop.plugin.json` 只登记元信息，不安装或启动任何代码。

浏览器桥接可在设置 → 应用插件 → 高级：连接开发版浏览器扩展中登记扩展 ID；也可执行 `beaconhop --register-browser-host edge EXTENSION_ID`，自动使用当前可执行文件路径，保留此前登记的其他扩展 ID。Windows 注册在当前用户 HKCU，无需管理员权限。插件启停只控制 BH 使用该适配器，不卸载应用扩展。

```sh
node plugins/sdk/cli.cjs create ../my-adapter author.application
node plugins/sdk/cli.cjs check ../my-adapter/beaconhop.plugin.json
node plugins/sdk/cli.cjs install-vsix ./beaconhop-tabs-0.2.0.vsix
node plugins/sdk/cli.cjs probe vscode
```

当前交付本地 SDK tarball、VSIX 和 unpacked 浏览器扩展；npm、VS Code Marketplace、浏览器商店尚未发布。插件市场、下载更新与作者签名验证不包含在此版本。完整接入约定见 SDK 文档。
