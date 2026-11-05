#!/usr/bin/env python3
"""Read-only native regression using an existing window on an inactive Space.

Usage: python3 scripts/macos-inventory-recovery.py PID WINDOW_ID [--bridge PATH]
Requires Accessibility access. Does not activate, move or modify any window.
The selected window must be omitted by the application's public AXWindows list.
Builds the actual bridge with a same-file test driver so only its private cache
is disturbed. Generated sources, executable and receipts stay under logs/.
"""
import argparse
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('pid', type=int)
parser.add_argument('window', type=int)
parser.add_argument('--bridge', type=pathlib.Path, default=root/'src-tauri/native/BeaconBridge.swift')
args = parser.parse_args()
(root/'logs').mkdir(exist_ok=True)
output = pathlib.Path(tempfile.mkdtemp(prefix='inventory-recovery-', dir=root/'logs'))
driver = r'''
let testPID = pid_t(CommandLine.arguments[1])!
let testID = UInt32(CommandLine.arguments[2])!
func require(_ condition: Bool, _ message: String) {
    if !condition { fputs(message + "\n", stderr); exit(1) }
}
require(AXIsProcessTrusted(), "Accessibility permission is required")
private let (testConnection,testActive,_,testMembership) = spaces()
let testSpaces = testMembership?(testConnection,7,[NSNumber(value:testID)] as CFArray)?.takeRetainedValue() as? [UInt64] ?? []
require(!testSpaces.isEmpty && testActive.isDisjoint(with:testSpaces), "Choose a window on an inactive Space")
let testApp = AXUIElementCreateApplication(testPID)
let testPublished = attr(testApp,kAXWindowsAttribute) as? [AXUIElement] ?? []
require(!testPublished.contains { windowID($0) == testID }, "AXWindows already publishes this window; choose another")
func recover(_ phase: String) -> UInt64 {
    let deadline = DispatchTime.now().uptimeNanoseconds + 4_000_000_000
    repeat {
        let found = windows(testPID,candidates:[testID],spaceWindows:[testID])
        if found[testID] != nil { return scanCursor[testPID] ?? 0 }
        Thread.sleep(forTimeInterval:0.55)
    } while DispatchTime.now().uptimeNanoseconds < deadline
    require(false, "Failed to recover off-Space window after " + phase)
    return 0
}
let initialCursor = recover("initial discovery")
require(initialCursor > 0, "Test requires remote discovery")
// A transient WindowServer omission removes a cached root even though the
// actual native window remains open on its original desktop.
_ = windows(testPID,candidates:[],spaceWindows:[])
require(cachedWindow(testPID,testID) == nil, "Omission did not evict the test root")
let omissionCursor = recover("transient candidate omission")
// bhSnapshot also evicts roots when AX reports invalidUIElement.
rootsLock.lock(); roots[testPID]?.removeValue(forKey:testID); rootsLock.unlock()
let invalidationCursor = recover("AX root invalidation")
// A public AX discovery may finish a previously pending remote search.
// A completed inventory must clear that pending search's retry/backoff state.
scanRetries[testPID] = ([UInt32.max],6,UInt64.max)
scanCursor[testPID] = UInt64.max / 2
_ = windows(testPID,candidates:[testID],spaceWindows:[testID])
require(scanRetries[testPID] == nil && scanCursor[testPID] == nil, "Completed inventory retained a stale search")
// An unchanged unresolved search must keep advancing across bounded passes.
let pending: Set<UInt32> = [testID,UInt32.max]
_ = windows(testPID,candidates:pending,spaceWindows:pending)
let firstPass = scanCursor[testPID] ?? 0
Thread.sleep(forTimeInterval:0.6)
_ = windows(testPID,candidates:pending,spaceWindows:pending)
require(firstPass > 0 && (scanCursor[testPID] ?? 0) > firstPass, "Unchanged search repeated its prefix")
let result: [String:Any] = ["passed":true,"pid":testPID,"window":testID,"desktopIds":testSpaces.map(String.init),
    "initialCursor":initialCursor,"omissionCursor":omissionCursor,"invalidationCursor":invalidationCursor,
    "continuedSweep":true]
print(String(data:try! JSONSerialization.data(withJSONObject:result,options:.sortedKeys),encoding:.utf8)!)
'''
source = output/'main.swift'
source.write_text(args.bridge.read_text() + '\n' + driver)
subprocess.run(['xcrun','swiftc','-swift-version','5','-O',str(source),'-o',str(output/'driver')], check=True)
result = subprocess.run([str(output/'driver'),str(args.pid),str(args.window)], capture_output=True, text=True)
(output/'result.json').write_text(result.stdout)
(output/'stderr.log').write_text(result.stderr)
print(result.stdout or result.stderr, end='')
print('Evidence: ' + str(output))
raise SystemExit(result.returncode)
