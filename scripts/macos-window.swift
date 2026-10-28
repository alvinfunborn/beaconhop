import AppKit
import ApplicationServices
@_silgen_name("_AXUIElementGetWindow") func getID(_ element:AXUIElement,_ id:UnsafeMutablePointer<UInt32>)->AXError
func attr(_ e:AXUIElement,_ key:String)->CFTypeRef?{var v:CFTypeRef?;return AXUIElementCopyAttributeValue(e,key as CFString,&v) == .success ? v:nil}
let pid=Int32(CommandLine.arguments[1])!;let app=AXUIElementCreateApplication(pid)
let all=attr(app,kAXWindowsAttribute) as? [AXUIElement] ?? []
let action=CommandLine.arguments.count>2 ? CommandLine.arguments[2]:"list"
let wanted=CommandLine.arguments.count>3 ? UInt32(CommandLine.arguments[3])!:0
for w in all{var id:UInt32=0;_ = getID(w,&id);if action=="list"{print(id,attr(w,kAXTitleAttribute) ?? "" as CFString,attr(w,kAXPositionAttribute) ?? "" as CFString)}
 else if id==wanted{
  if action=="focus"{_ = AXUIElementSetAttributeValue(app,kAXFocusedWindowAttribute as CFString,w);_ = AXUIElementPerformAction(w,kAXRaiseAction as CFString);_ = AXUIElementSetAttributeValue(w,kAXMainAttribute as CFString,kCFBooleanTrue);NSRunningApplication(processIdentifier:pid)?.activate(options:[]);_ = AXUIElementPerformAction(w,kAXRaiseAction as CFString)
   if let value=attr(w,kAXPositionAttribute) {var point=CGPoint.zero;AXValueGetValue(unsafeBitCast(value,to:AXValue.self),.cgPoint,&point);point.x += 100;point.y += 10
    for type in [CGEventType.leftMouseDown,.leftMouseUp]{CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:point,mouseButton:.left)?.post(tap:.cghidEventTap);Thread.sleep(forTimeInterval:0.05)}
   }}
  if action=="minimize"{_ = AXUIElementSetAttributeValue(w,kAXMinimizedAttribute as CFString,kCFBooleanTrue)}
 }
}
