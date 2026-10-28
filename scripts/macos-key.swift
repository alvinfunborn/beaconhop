import AppKit
// Arguments are event triples: keycode down|up modifier-flags. Key codes are physical macOS codes.
let args=Array(CommandLine.arguments.dropFirst())
if args.first == "--text", args.count == 2 {
 let text = Array(args[1].utf16)
 for down in [true, false] {
  let event=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:down)!
  event.keyboardSetUnicodeString(stringLength:text.count,unicodeString:text)
  event.post(tap:.cghidEventTap)
  Thread.sleep(forTimeInterval:0.08)
 }
 exit(0)
}
for i in stride(from:0,to:args.count,by:3){
 guard i+2<args.count,let code=UInt16(args[i]),let flags=UInt64(args[i+2]) else {exit(2)}
 let down=args[i+1]=="down"
 let event=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down)!
 event.flags=CGEventFlags(rawValue:flags);event.post(tap:.cghidEventTap)
 Thread.sleep(forTimeInterval:0.08)
}
