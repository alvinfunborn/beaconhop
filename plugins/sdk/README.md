# BeaconHop plugin SDK

A dependency-free Node 18+ adapter SDK. BeaconHop discovers running application extensions automatically; authors do not modify or rebuild BeaconHop. Protocol v1 works on macOS and Windows. This SDK package is currently distributed as a local `.tgz`; it has not been published to npm.

From this repository:

```sh
node plugins/sdk/cli.cjs create ../notes-adapter example.notes
node plugins/sdk/cli.cjs check ../notes-adapter/beaconhop.plugin.json
```

Or install the supplied SDK tarball with `npm install ./beaconhop-plugin-sdk-0.1.0.tgz`, then run `npx beaconhop-plugin create ./notes-adapter example.notes`. The scaffold includes the SDK runtime, types, license, manifest and an application binding template. It refuses to overwrite any existing directory. It is a binding template, not a working adapter for an arbitrary application.

## Connect from the application's extension

Change the manifest's `appIds` to the host's macOS bundle ID and Windows executable basename. Give your adapter a stable, unique ID (`author.application` is recommended) and semantic version. Implement `list` and `activate` using the application's own API. The scaffold's `connect(application)` expects `listContexts`, `selectItem`, and `selectedItem`; replace these with your host API. Dispose the connection during extension deactivation.

```js
const {startPlugin} = require('@beaconhop/plugin-sdk');
const connection = await startPlugin({
  manifest: require('./beaconhop.plugin.json'),
  list: async ({signal}) => ({contexts: await application.listWindows({signal})}),
  activate: async (target, {signal}) => {
    await application.select(target, {signal});
    const current = await application.selection({signal});
    if (current.context !== target.context || current.item !== target.item)
      throw Error('Selection was not confirmed');
    return {...target, verified: true};
  },
});
// On shutdown: await connection.dispose();
```

`list` returns `{contexts:[{id,focused,items:[{id,title,subtitle?,active?,icon?,preview?}]}]}`. IDs identify exact live objects: use distinct IDs for the same file in different groups. Keep IDs stable during the object's lifetime and reject closed targets. Never reuse a removed object's ID in the same connection. Each application window may run its own SDK instance; at most one context across matching instances should be focused. Do not mark background windows focused. BH activates the owning native window before selecting content; the current tab list is scoped to the focused application window.

`activate({context,item}, {signal})` must read back the exact selection before returning `{context,item,verified:true}`. Check the AbortSignal before further mutations, and cancel pending work when it aborts. SDK timeouts cannot undo an application command already submitted; do not schedule delayed activation after a request fails. Work must finish within 2.5 seconds. `onError` receives discovery heartbeat errors. The host application's event loop owns lifetime; the SDK does not keep a standalone script alive.

## Optional cached previews

Contexts may set `presentation: "text" | "thumbnails"` in their inventory.
Without this field BH selects thumbnails for endpoints with the `thumbnails`
capability and text otherwise. Use explicit `text` for text-oriented content
even when optional images are available. The user's list preference can also
replace a thumbnail grid. Items may include a searchable `description` of up
to 8 KiB UTF-8 in addition to title and subtitle. Text rows never request images
or show a missing-preview placeholder. No core changes or provider-specific UI
branches are needed for a new adapter.

Advertise `capabilities:["thumbnails"]`, mark only cached items `preview:true`, and implement `thumbnails({context,items:[{id,url}]}, {signal})`. Return `{context,items:[{id,url,image}]}` for available exact matches. `url` is the item's subtitle/cache revision key, not an instruction to fetch a URL. `image` must be an inline JPEG no larger than 60 KiB; at most eight images per call. Omit missing/stale entries. Never activate hidden tabs to obtain a preview. Icons are optional inline PNGs up to 8 KiB. No remote image loads occur in BH.

## Installation and diagnosis

Distribute the host's native extension format (VSIX, browser extension, etc.). SDK adapters register their metadata and live connection automatically when the host extension starts. No BH restart or port configuration is needed. Settings → Navigation layers → Application plugins shows live/offline instances, versions and enable switches. Disabling affects all instances of that provider in BH and persists across reconnects. It does not unload the host extension.

```sh
# Install a trusted VSIX with the official VS Code CLI, then open/reload VS Code.
beaconhop-plugin install-vsix ./beaconhop-tabs-0.2.0.vsix
# For a nonstandard installation, pass --code /absolute/path/to/Code.exe (Windows)
# or --code '/Applications/Visual Studio Code.app/Contents/MacOS/Code' (macOS).
# --extensions-dir and --user-data-dir are supported for isolated validation.

# Browser: first load/install the extension, then copy its 32-letter ID.
beaconhop-plugin register-browser edge EXTENSION_ID --beaconhop /absolute/path/to/beaconhop
# The same registration is available directly in BH settings, without Node.

# Import offline metadata only; does not launch or install code.
beaconhop-plugin register ./beaconhop.plugin.json
# Read-only list check; prints counts, never secrets, document titles or URLs.
beaconhop-plugin probe example.notes
```

The Node SDK cannot run inside a browser service worker. Browsers use `plugins/browser` plus BH's Native Messaging host, exposing the same protocol to BH. VS Code uses the SDK directly. Codex currently remains a built-in adapter with dispatch-only activation semantics.

Discovery uses `~/.beaconhop/plugins` (`%USERPROFILE%\.beaconhop\plugins` on Windows), overridable with `BEACONHOP_PLUGIN_DIR` for tests. Private loopback connections carry a per-instance token; tokens are not a sandbox against other processes running as the same user. Discovery refreshes every five seconds and expires after twenty seconds. SDK disposal removes the live endpoint, retaining metadata under `registry/`. BH stores disabled IDs separately in `preferences.json`; reimport does not override user opt-out.

The SDK rejects invalid manifests, duplicate IDs, ambiguous focus, unverified activation, oversized frames and invalid images. Limits: 256 contexts, 2,000 items per context, 1 MiB per message and eight concurrent connections. A provider ID represents one adapter family, not an author authentication mechanism. Only install application extensions you trust. There is no remote package downloader, background executable launcher, marketplace, signature/update service, or npm publication in this version.

## Verify and package

From the BH repository run `npm run test:plugins`, `npm run plugins:prepare`, and package VS Code with `npx @vscode/vsce package` inside `plugins/vscode`. Its `vscode:prepublish` step bundles the same SDK source. `plugins/vscode/test/integration.cjs` runs against the real VS Code extension development host. SDK tests exercise sockets, stale contexts, authentication, framing, cancellation, registry lifecycle and the scaffold.

Authors should also verify their host API against multiple windows, duplicate titles, close/reopen, inactive windows, focus changes, and remote workspaces. A passing protocol test alone does not prove correct host selection.

Installation flags follow the [official VS Code CLI documentation](https://code.visualstudio.com/docs/configure/command-line).
