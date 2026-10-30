import Foundation

/// Output stream the command writes to; tests pass their own.
public protocol TextSink {
  mutating func write(_ text: String)
}

/// Runs the tool; returns the exit code. Arguments exclude the program name.
public func runCli(
  arguments: [String], out: inout some TextSink, err: inout some TextSink
) -> Int32 {
  guard arguments.count <= 1 else {
    err.write("usage: app [name]\n")
    return 1
  }
  out.write(greeting(arguments.first ?? "") + "\n")
  return 0
}

public func greeting(_ name: String) -> String {
  let trimmed = name.trimmingCharacters(in: .whitespaces)
  return "Hello, \(trimmed.isEmpty ? "world" : trimmed)!"
}
