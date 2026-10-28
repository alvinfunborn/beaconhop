// Native QA helper; compile into ignored logs/ for local acceptance tests.
import AppKit
import ApplicationServices
import Foundation
@_silgen_name("_AXUIElementGetWindow") func windowID(_ element:AXUIElement,_ id:UnsafeMutablePointer<UInt32>)->AXError
let wantedPID=Int32(CommandLine.arguments[1])!
var wantedID=UInt32(CommandLine.arguments[2])!
let secondID=UInt32(CommandLine.arguments[3])!
let system=AXUIElementCreateSystemWide()
AXUIElementSetMessagingTimeout(system,0.05)
func focused()->Bool {
 var appRaw:CFTypeRef?, windowRaw:CFTypeRef?
 guard AXUIElementCopyAttributeValue(system,kAXFocusedApplicationAttribute as CFString,&appRaw)==AXError.success,let appRaw else{return false}
 let app=unsafeBitCast(appRaw,to:AXUIElement.self);var pid:pid_t=0
 guard AXUIElementGetPid(app,&pid)==AXError.success,pid==wantedPID else{return false}
 guard AXUIElementCopyAttributeValue(app,kAXFocusedWindowAttribute as CFString,&windowRaw)==AXError.success,let windowRaw else{return false}
 var id:UInt32=0;_ = windowID(unsafeBitCast(windowRaw,to:AXUIElement.self),&id)
 return id==wantedID
}
func send(_ code:CGKeyCode,_ down:Bool,_ flags:CGEventFlags){
 let event=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down)!
 event.flags=flags;event.post(tap:.cghidEventTap);usleep(3000)
}
func toggle(){send(58,true,.maskAlternate);send(48,true,.maskAlternate);send(48,false,.maskAlternate);send(58,false,[])}
func waitFocus()->Bool {
 let start=DispatchTime.now().uptimeNanoseconds
 repeat{if focused(){return true};usleep(1000)}while DispatchTime.now().uptimeNanoseconds-start<1_500_000_000
 return false
}
guard !focused() else{fatalError("First target already focused")}
toggle();let first=waitFocus();let firstAt=DispatchTime.now().uptimeNanoseconds
wantedID=secondID
toggle();let second=waitFocus()
print("{\"first\":\(first),\"second\":\(second),\"secondMs\":\(Double(DispatchTime.now().uptimeNanoseconds-firstAt)/1_000_000)}")
