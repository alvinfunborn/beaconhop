# Screen Buoy integration

BeaconHop and Screen Buoy remain separately installed applications. The integration
defaults to off. Opening settings, detecting an installation, and enabling the
integration do not start SB. An extension gesture or an explicit connection/setup
button starts SB when needed. Once started, SB keeps its normal lifetime and its
own login-start preference; disabling integration does not terminate it.

## Gesture

1. Use any BH layer and type a desktop, window, application-window or tab hint.
   The final keydown activates the selected target.
2. Keep that final hint key pressed and press a configured extension key. The BH
   modifier may already be released. Both `HintLeftKey` and `HintRightKey` are
   enabled by default. Either one invokes the same handoff; additional physical
   keys can be added as alternatives, without pressing them together.
3. The extension keydown hands off to SB once target activation is confirmed,
   without waiting for the BH hint or modifiers to be released. SB ignores
   the old gesture’s repeats and releases; fresh input uses its own hint actions.

Desktop hints open desktop-scoped SB, including on empty desktops. On macOS,
shared Spaces cover all active displays; separate Spaces stay on the selected
Space's display. Windows covers all displays of that virtual desktop.
Window, application-window and tab hints open window-scoped
SB, with tabs retaining their exact native parent window. All four use the same
configured SB extension keys.

Releasing the final hint key without an extension is an ordinary BH jump. Escape,
unrelated input, a new BH session, failed focus, or changed configuration cancels
the pending extension. While SB is still acknowledging the handoff, the cancelling
non-modifier input and its repeats/releases are consumed, so they cannot type or
run a command in the target application. No delay is added to window switching. Left/right aliases
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
The connection panel distinguishes an incompatible version, unchecked permissions,
missing Accessibility access, and an unavailable keyboard listener. It only asks
for Accessibility access after a compatible SB reports that it is missing; an
already-ready connection does not show permission setup instructions.

Screen Buoy v1.5.0 is the release candidate for this protocol-3 integration;
v1.4.3 predates it. The download flow checks the actual latest release's marker
before offering an artifact. A compatible locally packaged app can also be selected by its application path.
Raw development binaries still require SB's own config and frontend dev server;
they are not detected as installed applications.

## Protocol and target scope

The implementation is in `src-tauri/src/screen_buoy.rs` and SB's
`src-tauri/src/beaconhop.rs`. Protocol 3 uses a per-request loopback callback on an
OS-assigned port, a random token, and bounded timeouts. There is no permanent
listener, fixed port, heartbeat, or simulated global hotkey. The callback closes
after acknowledgement; SB does not depend on a continuing BH connection.

BH starts the selected application with `--beaconhop-request` and a JSON request
containing version, action (`hints`, `status`, or `settings`), a tagged `target`,
callback port, token and originating physical key codes (`heldKeys`). The target
is `{scope:"window",pid,nativeId}` or `{scope:"desktop",desktopId,displayId}`;
status/settings requests have no target. Both apps require protocol 3, retaining
held-key draining and rejecting older window-only peers before launch.
macOS app bundles launch through Launch
Services in the background (`open -g -n`), including the short-lived forwarding
instance. On a cold integration launch, SB also prohibits application activation
both immediately in AppKit and in the event loop's launch policy, until all
hidden webviews have been created;
the framework otherwise activates the app even with `open -g`. SB then restores
its normal accessory policy. SB's single-instance handler forwards requests
without bringing settings forward for a hint request. A cold hint request also
waits for overlay pages to confirm their styles and event listeners are ready,
so the first hint session cannot be emitted before the pages can display it.
SB sends a hello; BH checks
the token and current gesture/focus before sending `begin`; SB validates the
target and acknowledges initialization or reports an error.

Window sessions filter cache replay and progressive additions by native window
ID, PID, frame and bounds. Grids cover that window rather than the whole display.
On macOS, focus is verified on the requested PID using `AXFrontmost` and the
exact `AXFocusedWindow` ID. System-wide `AXFocusedApplication` can return
`AXErrorNoValue` despite a valid foreground window, so it is not used as the
handoff gate. Moved, closed or unfocused targets end the scoped session. The ordinary SB global
hint path and its append-only code allocation remain available.

Desktop sessions verify the native desktop identity before opening and throughout
the session. Their grids cover the selected displays; cached/progressive controls
must match a currently visible window's ID, PID and frame, and lie within those
displays. Prior-desktop cache entries are rejected. Switching away or changing
display geometry closes the session; no focused window is required.

`beaconhop-integration.json` accompanies SB app resources, portable executables
and release assets. It declares protocol support without
starting the application; the runtime handshake confirms the running instance.
Release CI must publish the marker alongside both platform artifacts.
