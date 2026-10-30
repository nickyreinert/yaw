import XCTest

@testable import AppCore

struct Buffer: TextSink {
  var text = ""
  mutating func write(_ text: String) { self.text += text }
}

final class CliTests: XCTestCase {
  func testGreetsByName() {
    var out = Buffer()
    var err = Buffer()
    XCTAssertEqual(runCli(arguments: ["Ada"], out: &out, err: &err), 0)
    XCTAssertEqual(out.text, "Hello, Ada!\n")
    XCTAssertEqual(err.text, "")
  }

  func testGreetsTheWorldWithoutAName() {
    var out = Buffer()
    var err = Buffer()
    XCTAssertEqual(runCli(arguments: [], out: &out, err: &err), 0)
    XCTAssertEqual(out.text, "Hello, world!\n")
  }

  func testTooManyArgumentsPrintUsage() {
    var out = Buffer()
    var err = Buffer()
    XCTAssertEqual(runCli(arguments: ["a", "b"], out: &out, err: &err), 1)
    XCTAssertEqual(out.text, "")
    XCTAssertEqual(err.text, "usage: app [name]\n")
  }
}
