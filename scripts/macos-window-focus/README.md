# Native window focus regression (macOS)

This opt-in test opens two disposable applications with two windows each on the
current desktop. Run in an authorized desktop session with Accessibility access;
it cannot run in headless CI. Follow the host's build/UI resource scheduling rules.

From the repository root, compile the actual native bridge and fixture:

```sh
mkdir -p logs/window-focus
xcrun swiftc -swift-version 5 -O src-tauri/native/BeaconBridge.swift scripts/macos-window-focus/main.swift -o logs/window-focus/driver
xcrun swiftc scripts/macos-window-focus/fixture.swift -o logs/window-focus/fixture
python3 scripts/macos-window-focus/run.py --driver logs/window-focus/driver --fixture logs/window-focus/fixture --output logs/window-focus/result.json
```

The test interleaves windows belonging to different applications. It checks both
the exact focused window ID and the ordering of unselected windows, including
activation within an already active application, restoration of a minimized
window, a hidden application and rejection of a closed target. This catches
application-wide restacking that a focused-window-only assertion misses.

All owned fixture processes are stopped in `finally`. Original focus is restored
if a fixture still owns it; an external focus change is recorded instead of
overridden. Avoid interacting with the desktop during the test. Fullscreen and
cross-Space behavior require separate interactive acceptance.

To demonstrate the original regression, compile a pre-fix `BeaconBridge.swift`
with the same driver and pass `--expect-group-raise`. That mode runs the initial
background-application case and requires the unwanted sibling promotion.
