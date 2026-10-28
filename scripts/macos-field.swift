// Native QA helper; compile into ignored logs/ for local acceptance tests.
import ApplicationServices
import Foundation
func attr(_ e:AXUIElement,_ name:String)->CFTypeRef? {var value:CFTypeRef?;return AXUIElementCopyAttributeValue(e,name as CFString,&value)==AXError.success ? value:nil}
let app=AXUIElementCreateApplication(Int32(CommandLine.arguments[1])!)
guard let raw=attr(app,kAXFocusedUIElementAttribute) else {FileHandle.standardError.write(Data("No focused element\n".utf8));exit(2)}
let field=unsafeBitCast(raw,to:AXUIElement.self)
var texts=[String]();var visited=0
func walk(_ node:AXUIElement,_ depth:Int){
 guard depth<20 && visited<2000 else{return};visited += 1
 if let value=attr(node,kAXValueAttribute) as? String,!value.isEmpty {texts.append(value)}
 if let children=attr(node,kAXChildrenAttribute) as? [AXUIElement] {children.forEach{walk($0,depth+1)}}
}
if CommandLine.arguments.count>2 {walk(app,0)}
let data=try JSONSerialization.data(withJSONObject:["texts":texts,"role":attr(field,kAXRoleAttribute) as? String ?? "", "value":attr(field,kAXValueAttribute) as? String ?? "", "description":attr(field,kAXDescriptionAttribute) as? String ?? ""])
print(String(data:data,encoding:.utf8)!)
