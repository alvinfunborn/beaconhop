// Native QA helper; compile into ignored logs/ for local acceptance tests.
import Carbon
import Foundation
func sourceID(_ source:TISInputSource)->String {
 guard let raw=TISGetInputSourceProperty(source,kTISPropertyInputSourceID) else { return "" }
 return Unmanaged<CFString>.fromOpaque(raw).takeUnretainedValue() as String
}
let sources=TISCreateInputSourceList(nil,false).takeRetainedValue() as! [TISInputSource]
if CommandLine.arguments.dropFirst().first == "--list" {
 let data=try JSONSerialization.data(withJSONObject:sources.map{sourceID($0)})
 print(String(data:data,encoding:.utf8)!);exit(0)
}
if CommandLine.arguments.count>1 {
 let wanted=CommandLine.arguments[1]
 guard let source=sources.first(where:{sourceID($0)==wanted}) else {
  FileHandle.standardError.write(Data("Input source not enabled\n".utf8));exit(2)
 }
 let result=TISSelectInputSource(source)
 guard result==noErr else {FileHandle.standardError.write(Data("Input source selection failed\n".utf8));exit(3)}
}
print(sourceID(TISCopyCurrentKeyboardInputSource().takeRetainedValue()))
