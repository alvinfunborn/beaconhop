# Screen Buoy integration

BeaconHop and Screen Buoy remain separately installed applications. The integration
defaults to off. Opening settings, detecting an installation, and enabling the
integration do not start SB. An extension gesture or an explicit connection/setup
button starts SB when needed. Once started, SB keeps its normal lifetime and its
own login-start preference; disabling integration does not terminate it.

## Gesture

1. Use the BH hold shortcut and type a window hint. The final keydown immediately
   focuses the window, exactly as it does without integration.
2. Keep that final hint key pressed and press a configured extension key. The BH
   modifier may already be released. Both `HintLeftKey` and `HintRightKey` are
   enabled by default; additional physical keys such as Enter can also invoke
   the same handoff.
3. SB opens a hint session for the selected native window immediately on the
   extension keydown, without waiting for any keys to be released. Originating
   held keys are filtered until release so they cannot become SB hint input.
   Subsequent input and actions use SB's own settings.

Releasing the final hint key without an extension is an ordinary BH jump. Escape,
unrelated input, a new BH session, failed focus, or changed configuration cancels
the pending extension. No delay is added to window switching. Left/right aliases
refer to the last physical hint key, including punctuation and shifted symbols.
The map is configurable, including Space and keyboard row edges. A fixed extension
key cannot extend itself; configure another key for that hint.

## Setup and download

BH Settings → Screen Buoy guides users through installation, SB permissions,
connection checks and key configuration. Installation detection is offline and
accepts an optional explicit application path. It never silently substitutes a
different copy when that path is missing.

Downloads are checked only on request. BH resolves the official latest release,
then checks that exact tag's integration manifest and platform asset. macOS gets
the app ZIP; Windows gets the installer. A release without the protocol marker is
reported as incompatible. Network failures remain errors with retry and an
official-release-page fallback. Opening a browser download is not reported as
installation. macOS permissions belong to SB's actual executable, independently
of BH's permissions. Connection success and permission readiness are displayed
separately; neither proves an actual native hint interaction succeeded.

The public v1.4.3 release predates this integration. The modified SB source must
be built and released before the download flow can offer a compatible public
artifact. A compatible locally packaged app can be selected by its application path.
Raw development binaries still require SB's own config and frontend dev server;
they are not detected as installed applications.

## Protocol and window scope

The implementation is in `src-tauri/src/screen_buoy.rs` and SB's
`src-tauri/src/beaconhop.rs`. Protocol 2 uses a per-request loopback callback on an
OS-assigned port, a random token, and bounded timeouts. There is no permanent
listener, fixed port, or simulated global hotkey.

BH starts the selected executable with `--beaconhop-request` and a JSON request
containing version, action (`hints`, `status`, or `settings`), target PID/native
window ID, originating physical keycodes (`heldKeys`), callback port and token.
SB's single-instance handler forwards requests
without bringing settings forward for a hint request. SB sends a hello; BH checks
the token and current gesture/focus before sending `begin`; SB validates the
target and acknowledges initialization or reports an error.

Window sessions filter cache replay and progressive additions by native window
ID, PID, frame and bounds. Grids cover that window rather than the whole display.
Moved, closed or unfocused targets end the scoped session. The ordinary SB global
hint path and its append-only code allocation remain available.

`beaconhop-integration.json` accompanies SB app resources, portable executables
and release assets. It declares protocol support without
starting the application; the runtime handshake confirms the running instance.
Release CI must publish the marker alongside both platform artifacts.
