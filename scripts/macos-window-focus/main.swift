import AppKit
import ApplicationServices

@_silgen_name("_AXUIElementGetWindow") private func axID(_ element: AXUIElement, _ id: UnsafeMutablePointer<UInt32>) -> AXError

func report(_ object: [String: Any]) {
    print(String(data: try! JSONSerialization.data(withJSONObject: object, options: .sortedKeys), encoding: .utf8)!)
    fflush(stdout)
}
func state() -> [String: Any] {
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
    var focused: CFTypeRef?
    _ = AXUIElementCopyAttributeValue(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute as CFString, &focused)
    var id: UInt32 = 0
    if let focused { _ = axID(unsafeBitCast(focused, to: AXUIElement.self), &id) }
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], 0) as? [[String: Any]] ?? []
    return ["pid": pid, "focused": id, "order": windows.filter { $0[kCGWindowLayer as String] as? Int == 0 }.compactMap { $0[kCGWindowNumber as String] as? UInt32 }]
}
func activate(_ pid: Int32, _ id: UInt32) -> [String: Any] {
    // A just-launched fixture may register with NSWorkspace after the first scan.
    for _ in 0..<3 {
        guard let snapshot = bhSnapshot() else { continue }
        let data = Data(String(cString: snapshot).utf8)
        bhFree(snapshot)
        let rows = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if (rows?["windows"] as? [[String: Any]] ?? []).contains(where: { ($0["nativeId"] as? UInt32) == id && ($0["pid"] as? Int32) == pid }) { break }
        Thread.sleep(forTimeInterval: 0.15)
    }
    var error: String?
    if let result = bhActivate(pid, id) { error = String(cString: result); bhFree(result) }
    Thread.sleep(forTimeInterval: 0.4)
    return DispatchQueue.main.sync {
        var result = state(); result["error"] = error as Any? ?? NSNull(); return result
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
guard AXIsProcessTrusted() else { fputs("Accessibility permission is required.\n", stderr); exit(2) }
if CommandLine.arguments.count == 1 { report(state()); exit(0) }
DispatchQueue.global().async {
    if CommandLine.arguments[1] == "--server" {
        // Keep one AppKit run loop, matching BH. Repeatedly launching GUI-aware
        // command tools can itself change application activation during a test.
        while let line = readLine(), let data = line.data(using: .utf8),
              let args = try? JSONDecoder().decode([Int64].self, from: data) {
            if args.isEmpty { DispatchQueue.main.sync { report(state()) } }
            else if args.count == 2 { report(activate(Int32(args[0]), UInt32(args[1]))) }
        }
    } else {
        report(activate(Int32(CommandLine.arguments[1])!, UInt32(CommandLine.arguments[2])!))
    }
    exit(0)
}
app.run()
