import AppKit
final class Delegate:NSObject,NSApplicationDelegate,NSTextViewDelegate {
 var windows=[NSWindow]();var editors=[NSTextView]()
 func applicationDidFinishLaunching(_ notification:Notification){
  let screens=NSScreen.screens
  for i in 0..<2 {
   let screen=screens[min(i,screens.count-1)]
   let frame=NSRect(x:screen.frame.minX+100+CGFloat(i*70),y:screen.frame.minY+160,width:640,height:400)
   let window=NSWindow(contentRect:frame,styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
   window.collectionBehavior.insert(.fullScreenPrimary)
   window.title="BeaconHop QA \(i==0 ? "A" : "B")";window.isReleasedWhenClosed=false
   let editor=NSTextView(frame:NSRect(x:20,y:20,width:600,height:360));editor.string="Fixture \(i==0 ? "A" : "B") — no hint keys should appear here.\n";editor.font=NSFont.systemFont(ofSize:22);editor.delegate=self
   window.contentView?.addSubview(editor);window.makeFirstResponder(editor);window.makeKeyAndOrderFront(nil);window.setFrame(frame,display:true);windows.append(window);editors.append(editor)
  }
  NSApp.activate(ignoringOtherApps:true)
  Timer.scheduledTimer(withTimeInterval:0.1,repeats:true){_ in self.save()}
 }
 func save(){
  let commandURL=URL(fileURLWithPath:CommandLine.arguments[1]+".command")
  if let command=try? String(contentsOf:commandURL,encoding:.utf8){
   try? FileManager.default.removeItem(at:commandURL)
   if command=="fullscreen-b" { windows[1].toggleFullScreen(nil) }
   if command=="hide" { NSApp.hide(nil) }
   if command=="same-title" { windows.forEach { $0.title="BeaconHop QA nihao ni'hao 你好 同名窗口" } }
   if command=="close-b" { windows[1].close() }
  }
  let rows=zip(windows,editors).map{["id":$0.0.windowNumber,"key":$0.0.isKeyWindow,"title":$0.0.title,"text":$0.1.string,"mini":$0.0.isMiniaturized,"fullscreen":$0.0.styleMask.contains(.fullScreen)] as [String:Any]};if let data=try? JSONSerialization.data(withJSONObject:["pid":getpid(),"windows":rows]){try? data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]),options:.atomic)}}
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{true}
}
let app=NSApplication.shared;let delegate=Delegate();app.setActivationPolicy(.regular);app.delegate=delegate;app.run()
