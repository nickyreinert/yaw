import AppCore
import Foundation

struct StandardStream: TextSink {
  let handle: FileHandle
  mutating func write(_ text: String) {
    handle.write(Data(text.utf8))
  }
}

var out = StandardStream(handle: .standardOutput)
var err = StandardStream(handle: .standardError)
exit(runCli(arguments: Array(CommandLine.arguments.dropFirst()), out: &out, err: &err))
