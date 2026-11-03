import AppKit

final class Delegate: NSObject, NSApplicationDelegate {
    var windows = [NSWindow]()
    let state = URL(fileURLWithPath: CommandLine.arguments[1])
    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSScreen.screens[0].visibleFrame
        for index in 0..<2 {
            let window = NSWindow(contentRect: NSRect(x: frame.minX + 80 + CGFloat(index) * 100,
                y: frame.minY + 100, width: 400, height: 250),
                styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
            window.title = "BH focus regression \(CommandLine.arguments[2]) \(index)"
            window.isReleasedWhenClosed = false
            window.makeKeyAndOrderFront(nil)
            windows.append(window)
        }
        NSApp.activate(ignoringOtherApps: true)
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in self.tick() }
        tick()
    }
    func tick() {
        let command = state.appendingPathExtension("command")
        if let text = try? String(contentsOf: command, encoding: .utf8) {
            try? FileManager.default.removeItem(at: command)
            let parts = text.split(separator: " ")
            let index = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
            switch parts.first {
            case "focus": NSApp.activate(ignoringOtherApps: true); windows[index].makeKeyAndOrderFront(nil)
            case "minimize": windows[index].miniaturize(nil)
            case "hide": NSApp.hide(nil)
            case "close": windows[index].close()
            default: break
            }
        }
        let data = try! JSONSerialization.data(withJSONObject: ["pid": getpid(), "hidden": NSApp.isHidden, "active": NSApp.isActive,
            "windows": windows.map { ["id": $0.windowNumber, "key": $0.isKeyWindow,
                "minimized": $0.isMiniaturized] as [String: Any] }])
        try? data.write(to: state, options: .atomic)
    }
}
let app = NSApplication.shared
let delegate = Delegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
