import AppKit
import ApplicationServices
import ScreenCaptureKit
import Darwin

@_silgen_name("_AXUIElementGetWindow") private func axWindowID(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError
private func onMain<T>(_ fn: () -> T) -> T { Thread.isMainThread ? fn() : DispatchQueue.main.sync(execute: fn) }
private func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
private func windowID(_ element: AXUIElement) -> UInt32 { var id: UInt32 = 0; _ = axWindowID(element, &id); return id }
// AXWindows is scoped to the active Space. Keep validated roots and resolve
// WindowServer's missing roots in bounded background sweeps, never in the hook.
private let accessibilityTimeout: Void = { AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.1) }()
private let rootsLock = NSLock()
private var roots = [pid_t:[UInt32:AXUIElement]]()
private var scanCursor = [pid_t:UInt64]() // inventory worker only
private var scanRetries = [pid_t:(missing:Set<UInt32>, attempts:Int, next:UInt64)]()
private typealias RemoteElement = @convention(c) (CFData) -> Unmanaged<AXUIElement>?
private let remoteElement: RemoteElement? = {
    guard let address = dlsym(dlopen(nil, RTLD_LAZY), "_AXUIElementCreateWithRemoteToken") else {return nil}
    return unsafeBitCast(address, to:RemoteElement.self)
}()
private func cachedWindow(_ pid: pid_t, _ id: UInt32) -> AXUIElement? {
    rootsLock.lock(); defer {rootsLock.unlock()}; return roots[pid]?[id]
}
private func windows(_ pid: pid_t, candidates: Set<UInt32>, spaceWindows: Set<UInt32>) -> [UInt32:AXUIElement] {
    _ = accessibilityTimeout
    rootsLock.lock(); var found = roots[pid] ?? [:]; rootsLock.unlock()
    found = found.filter { candidates.contains($0.key) }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.1)
    var values: CFArray?
    _ = AXUIElementCopyMultipleAttributeValues(app, [kAXWindowsAttribute,kAXFocusedWindowAttribute,kAXMainWindowAttribute] as CFArray, [], &values)
    var published = [AXUIElement]()
    for value in values as? [CFTypeRef] ?? [] {
        if CFGetTypeID(value) == CFArrayGetTypeID() { published += value as? [AXUIElement] ?? [] }
        else if CFGetTypeID(value) == AXUIElementGetTypeID() { published.append(unsafeBitCast(value,to:AXUIElement.self)) }
    }
    for element in published { let id = windowID(element); if candidates.contains(id) {found[id] = element} }
    var missing = spaceWindows.subtracting(found.keys)
    let now = DispatchTime.now().uptimeNanoseconds
    let previous = scanRetries[pid]
    let changed = previous?.missing != missing
    if !missing.isEmpty, (changed || now >= (previous?.next ?? 0)), let create = remoteElement {
        // Remote AX token ABI: little-endian process, reserved, AppKit tag, element id.
        // Continue each process's sweep on later inventories instead of repeating a prefix.
        var token = Data(); var process = pid.littleEndian; var reserved: UInt32 = 0; var tag: UInt32 = 0x636f636f
        withUnsafeBytes(of:&process) {token.append(contentsOf:$0)}
        withUnsafeBytes(of:&reserved) {token.append(contentsOf:$0)}
        withUnsafeBytes(of:&tag) {token.append(contentsOf:$0)}
        token.append(Data(count:8))
        var cursor = scanCursor[pid] ?? 0
        let deadline = DispatchTime.now().uptimeNanoseconds + 35_000_000
        while !missing.isEmpty && DispatchTime.now().uptimeNanoseconds < deadline {
            var identifier = cursor.littleEndian
            withUnsafeBytes(of:&identifier) { token.replaceSubrange(12..<20,with:$0) }
            cursor &+= 1
            guard let element = create(token as CFData)?.takeRetainedValue() else {continue}
            let id = windowID(element)
            if missing.contains(id), attr(element,kAXRoleAttribute) as? String == kAXWindowRole {
                found[id] = element; missing.remove(id)
            }
        }
        scanCursor[pid] = cursor
        let attempts = changed ? 1 : (previous?.attempts ?? 0) + 1
        let delay: UInt64 = attempts < 6 ? 500_000_000 : 5_000_000_000
        scanRetries[pid] = (missing,attempts,DispatchTime.now().uptimeNanoseconds + delay)
    }
    rootsLock.lock(); roots[pid] = found; rootsLock.unlock()
    return found
}
private func json(_ object: Any) -> UnsafeMutablePointer<CChar>? {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) else { return strdup("{}") }
    return strdup(text)
}
private func rect(_ value: CGRect) -> [String: Double] { ["x":value.origin.x,"y":value.origin.y,"width":value.width,"height":value.height] }
private func bounds(_ position: CFTypeRef?, _ dimensions: CFTypeRef?, fallback: CGRect) -> CGRect {
    var point = fallback.origin; var size = fallback.size
    if let value = position, CFGetTypeID(value) == AXValueGetTypeID() { AXValueGetValue(unsafeBitCast(value, to: AXValue.self), .cgPoint, &point) }
    if let value = dimensions, CFGetTypeID(value) == AXValueGetTypeID() { AXValueGetValue(unsafeBitCast(value, to: AXValue.self), .cgSize, &size) }
    return CGRect(origin: point, size: size)
}
private let sky = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
private typealias Connection = @convention(c) () -> Int32
private typealias Managed = @convention(c) (Int32) -> Unmanaged<CFArray>?
private typealias Membership = @convention(c) (Int32, Int32, CFArray) -> Unmanaged<CFArray>?
private func symbol<T>(_ name: String, _: T.Type) -> T? { guard let sky, let p = dlsym(sky,name) else {return nil}; return unsafeBitCast(p, to:T.self) }
private func spaces() -> (Int32, Set<UInt64>, [UInt64:Int], Membership?) {
    guard let connection = symbol("SLSMainConnectionID",Connection.self), let managed = symbol("SLSCopyManagedDisplaySpaces",Managed.self) else { return (0, [], [:], nil) }
    let c = connection(); var active = Set<UInt64>(); var indexes = [UInt64:Int]()
    let displays = managed(c)?.takeRetainedValue() as? [[String:Any]] ?? []
    for display in displays {
        if let current = display["Current Space"] as? [String:Any], let id = current["id64"] as? UInt64 { active.insert(id) }
        for space in display["Spaces"] as? [[String:Any]] ?? [] { if let id = space["id64"] as? UInt64 { indexes[id] = indexes.count + 1 } }
    }
    return (c, active, indexes, symbol("SLSCopySpacesForWindows",Membership.self))
}
private var icons = [String:String]() // inventory worker owns this cache
private func icon(_ app: NSRunningApplication) -> String? {
    let key = app.bundleIdentifier ?? String(app.processIdentifier)
    if let result = icons[key] {return result}
    let data: Data? = onMain {
        guard let icon = app.icon else {return nil}
        let image = NSImage(size:NSSize(width:40,height:40)); image.lockFocus(); icon.draw(in:NSRect(x:0,y:0,width:40,height:40)); image.unlockFocus()
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data:tiff) else {return nil}
        return rep.representation(using:.png,properties:[:])
    }
    guard let data else {return nil}; let value = "data:image/png;base64," + data.base64EncodedString(); icons[key] = value; return value
}
@_cdecl("bh_free") public func bhFree(_ p: UnsafeMutablePointer<CChar>?) { free(p) }
@_cdecl("bh_focused") public func bhFocused() -> UnsafeMutablePointer<CChar>? {
    let pid = onMain { NSWorkspace.shared.frontmostApplication?.processIdentifier }
    guard let pid, pid != getpid() else { return nil }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.05)
    guard let element = attr(app, kAXFocusedWindowAttribute), CFGetTypeID(element) == AXUIElementGetTypeID() else { return nil }
    let id = windowID(unsafeBitCast(element, to: AXUIElement.self))
    return id == 0 ? nil : strdup("mac:\(pid):\(id)")
}
@_cdecl("bh_snapshot") public func bhSnapshot() -> UnsafeMutablePointer<CChar>? {
    autoreleasepool {
        let screenData: [(String,String,CGRect,Double)] = onMain {
            let top = NSScreen.screens.first?.frame.maxY ?? 0
            return NSScreen.screens.map { screen in
                let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue ?? "0"
                return (id,screen.localizedName,CGRect(x:screen.frame.minX,y:top-screen.frame.maxY,width:screen.frame.width,height:screen.frame.height),screen.backingScaleFactor)
            }
        }
        let mouse = CGEvent(source:nil)?.location ?? .zero
        let displays: [[String:Any]] = screenData.map { ["id":$0.0,"name":$0.1,"bounds":rect($0.2),"scale":$0.3] }
        let currentDisplay = screenData.first(where:{$0.2.contains(mouse)})?.0 ?? screenData.first?.0 ?? "0"
        let (connection,active,indexes,membership) = spaces()
        let cg = CGWindowListCopyWindowInfo([.optionAll,.excludeDesktopElements],0) as? [[String:Any]] ?? []
        var info = [UInt32:[String:Any]]()
        for item in cg { if let id = item[kCGWindowNumber as String] as? UInt32 {info[id] = item} }
        let apps = onMain { NSWorkspace.shared.runningApplications }
        let livePids = Set(apps.map { $0.processIdentifier })
        rootsLock.lock(); roots = roots.filter {livePids.contains($0.key)}; rootsLock.unlock()
        scanCursor = scanCursor.filter {livePids.contains($0.key)}
        scanRetries = scanRetries.filter {livePids.contains($0.key)}
        var spaceMembership = [UInt32:[UInt64]]()
        for (id,meta) in info where meta[kCGWindowLayer as String] as? Int == 0 {
            spaceMembership[id] = membership?(connection,7,[NSNumber(value:id)] as CFArray)?.takeRetainedValue() as? [UInt64] ?? []
        }
        let front = onMain { NSWorkspace.shared.frontmostApplication?.processIdentifier }
        var result = [[String:Any]](); var focused: String?; var warnings = [String]()
        if !AXIsProcessTrusted() { warnings.append("Accessibility permission is required to enumerate and focus individual windows.") }
        if membership == nil || active.isEmpty {warnings.append("Desktop membership is unavailable. Current-desktop filtering excludes unverified windows.")}
        for app in apps where app.processIdentifier != getpid() && app.activationPolicy != .prohibited {
            let appElement = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetMessagingTimeout(appElement, 0.08)
            let focusedElement = front == app.processIdentifier ? attr(appElement,kAXFocusedWindowAttribute) : nil
            let focusedNative = focusedElement.map { windowID(unsafeBitCast($0,to:AXUIElement.self)) } ?? 0
            let candidates = Set(info.compactMap { id,meta -> UInt32? in
                guard meta[kCGWindowOwnerPID as String] as? Int32 == app.processIdentifier,
                      meta[kCGWindowLayer as String] as? Int == 0,
                      let raw = meta[kCGWindowBounds as String] as? NSDictionary,
                      let frame = CGRect(dictionaryRepresentation:raw), frame.width >= 50, frame.height >= 30 else {return nil}
                return id
            })
            if candidates.isEmpty {continue}
            let spaceWindows = Set(candidates.filter { id in
                let member = spaceMembership[id] ?? []
                // AXWindows can omit another display's active Space too. The union
                // of active Spaces is for filtering, not for deciding AX reachability.
                return !member.isEmpty
            })
            for (id,element) in windows(app.processIdentifier,candidates:candidates,spaceWindows:spaceWindows) {
                var rawAttributes: CFArray?
                let keys = [kAXRoleAttribute,kAXSubroleAttribute,kAXPositionAttribute,kAXSizeAttribute,kAXTitleAttribute,kAXMinimizedAttribute]
                let status = AXUIElementCopyMultipleAttributeValues(element,keys as CFArray,[],&rawAttributes)
                if status == .invalidUIElement {
                    rootsLock.lock(); roots[app.processIdentifier]?.removeValue(forKey:id); rootsLock.unlock(); continue
                }
                guard status == .success, let attributes = rawAttributes as? [CFTypeRef], attributes.count == keys.count else {continue}
                let role = attributes[0] as? String ?? ""
                if role != kAXWindowRole {continue}
                let subrole = attributes[1] as? String ?? ""
                if ![kAXStandardWindowSubrole,kAXDialogSubrole,kAXSystemDialogSubrole].contains(subrole) {continue}
                let meta = info[id] ?? [:]
                if let layer = meta[kCGWindowLayer as String] as? Int, layer != 0 {continue}
                var fallback = CGRect.zero
                if let raw = meta[kCGWindowBounds as String] as? NSDictionary { fallback = CGRect(dictionaryRepresentation:raw) ?? .zero }
                let frame = bounds(attributes[2],attributes[3],fallback:fallback)
                if frame.width < 50 || frame.height < 30 {continue}
                let display = screenData.max { a,b in a.2.intersection(frame).area < b.2.intersection(frame).area }?.0 ?? currentDisplay
                let memberships = spaceMembership[id] ?? []
                let current: Any = !active.isEmpty && !memberships.isEmpty ? !active.isDisjoint(with:memberships) : NSNull()
                let key = "mac:\(app.processIdentifier):\(id)"
                if front == app.processIdentifier && focusedNative == id { focused = key }
                let desktop = memberships.first ?? 0
                result.append(["id":key,"nativeId":id,"pid":app.processIdentifier,"title":attributes[4] as? String ?? meta[kCGWindowName as String] as? String ?? app.localizedName ?? "Window",
                    "appName":app.localizedName ?? "Application","appId":app.bundleIdentifier ?? "","displayId":display,
                    "desktopId":desktop == 0 ? "" : String(desktop),"desktopName":indexes[desktop].map { "Desktop \($0)" } ?? "", "currentDesktop":current,
                    "minimized":attributes[5] as? Bool ?? false,"hidden":app.isHidden,"bounds":rect(frame),"icon":icon(app) as Any? ?? NSNull()])
            }
        }
        let zOrder = Dictionary(uniqueKeysWithValues:cg.enumerated().compactMap { index,item -> (UInt32,Int)? in
            (item[kCGWindowNumber as String] as? UInt32).map {($0,index)}
        })
        result.sort { (zOrder[$0["nativeId"] as? UInt32 ?? 0] ?? Int.max) < (zOrder[$1["nativeId"] as? UInt32 ?? 0] ?? Int.max) }
        return json(["windows":result,"displays":displays,"currentDisplay":currentDisplay,"focusedId":focused as Any? ?? NSNull(),"warnings":warnings])
    }
}
private extension CGRect { var area: Double { isNull ? 0 : width * height } }
@_cdecl("bh_activate") public func bhActivate(_ pid: Int32, _ id: UInt32) -> UnsafeMutablePointer<CChar>? {
    guard let app = NSRunningApplication(processIdentifier:pid), let window = cachedWindow(pid,id), windowID(window) == id else {return strdup("The selected window has closed.")}
    let appElement = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(appElement,0.25)
    _ = AXUIElementSetAttributeValue(window,kAXMinimizedAttribute as CFString,kCFBooleanFalse)
    onMain { app.unhide(); app.activate(options:[]) }
    _ = AXUIElementSetAttributeValue(appElement,kAXFrontmostAttribute as CFString,kCFBooleanTrue)
    _ = AXUIElementSetAttributeValue(appElement,kAXFocusedWindowAttribute as CFString,window)
    _ = AXUIElementSetAttributeValue(window,kAXMainAttribute as CFString,kCFBooleanTrue)
    _ = AXUIElementPerformAction(window,kAXRaiseAction as CFString)
    for attempt in 0..<30 {
        let front = onMain { NSWorkspace.shared.frontmostApplication?.processIdentifier }
        if front == pid, let value = attr(appElement,kAXFocusedWindowAttribute), windowID(unsafeBitCast(value,to:AXUIElement.self)) == id {return nil}
        if attempt == 8 {
            _ = AXUIElementSetAttributeValue(appElement,kAXFrontmostAttribute as CFString,kCFBooleanTrue)
            _ = AXUIElementSetAttributeValue(appElement,kAXFocusedWindowAttribute as CFString,window)
            _ = AXUIElementPerformAction(window,kAXRaiseAction as CFString)
        }
        Thread.sleep(forTimeInterval:0.05)
    }
    return strdup("macOS did not focus the requested window. Check Accessibility and desktop switching permissions.")
}
// One shareable-content query per batch, with at most four screenshot requests in flight.
// Called off the event tap and main thread; timed-out callbacks own their state safely.
@_cdecl("bh_thumbnails") public func bhThumbnails(_ raw: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard CGPreflightScreenCaptureAccess(), let raw,
          let input = String(cString:raw).data(using:.utf8),
          let ids = try? JSONDecoder().decode([UInt32].self,from:input) else {return nil}
    let contentReady = DispatchSemaphore(value:0), contentLock = NSLock()
    var shared: SCShareableContent?
    SCShareableContent.getExcludingDesktopWindows(true,onScreenWindowsOnly:false) { content,_ in
        contentLock.lock(); shared = content; contentLock.unlock(); contentReady.signal()
    }
    guard contentReady.wait(timeout:.now()+1.5) == .success else {return nil}
    contentLock.lock(); let content = shared; contentLock.unlock()
    guard let content else {return nil}
    let wanted = Set(ids), windows = content.windows.filter{wanted.contains($0.windowID)}
    let group = DispatchGroup(), slots = DispatchSemaphore(value:4), lock = NSLock()
    var images = [String:String]()
    for window in windows {
        group.enter()
        DispatchQueue.global(qos:.userInitiated).async {
            guard slots.wait(timeout:.now()+2) == .success else {group.leave();return}
            let config = SCStreamConfiguration()
            let factor = min(1,512 / max(1,max(window.frame.width,window.frame.height)))
            config.width = max(1,Int(window.frame.width * factor)); config.height = max(1,Int(window.frame.height * factor))
            config.showsCursor = false; config.scalesToFit = true; config.captureResolution = .nominal
            SCScreenshotManager.captureImage(contentFilter:SCContentFilter(desktopIndependentWindow:window),configuration:config) { image,_ in
                if let image, let data = NSBitmapImageRep(cgImage:image).representation(using:.jpeg,properties:[.compressionFactor:0.78]) {
                    lock.lock(); images[String(window.windowID)] = "data:image/jpeg;base64," + data.base64EncodedString(); lock.unlock()
                }
                slots.signal(); group.leave()
            }
        }
    }
    _ = group.wait(timeout:.now()+2.5)
    lock.lock(); let result = images; lock.unlock()
    return json(result)
}
@_cdecl("bh_screen_permission") public func bhScreenPermission(_ request: Bool) -> Bool { request ? CGRequestScreenCaptureAccess() : CGPreflightScreenCaptureAccess() }
@_cdecl("bh_panel") public func bhPanel(_ raw: UnsafeMutableRawPointer?, _ search: Bool) {
    guard let raw else {return}; let window = Unmanaged<NSWindow>.fromOpaque(raw).takeUnretainedValue()
    window.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary,.stationary,.ignoresCycle]
    window.level = .floating
    if search {NSApp.activate(ignoringOtherApps:true);window.makeKeyAndOrderFront(nil)} else {window.orderFrontRegardless()}
}
@_cdecl("bh_focus_settings") public func bhFocusSettings(_ raw: UnsafeMutableRawPointer?) {
    guard let raw else {return}
    let window = Unmanaged<NSWindow>.fromOpaque(raw).takeUnretainedValue()
    NSApp.activate(ignoringOtherApps:true)
    window.makeKeyAndOrderFront(nil)
}
