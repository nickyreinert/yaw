import XCTest

@testable import AppCore

final class CounterTests: XCTestCase {
  func testStartsAtZero() {
    XCTAssertEqual(Counter().value, 0)
    XCTAssertEqual(Counter().title, "Tap to start")
  }

  func testIncrementCounts() {
    var counter = Counter()
    counter.increment()
    XCTAssertEqual(counter.title, "Tapped 1 time")
    counter.increment()
    XCTAssertEqual(counter.title, "Tapped 2 times")
  }

  func testResetGoesBackToZero() {
    var counter = Counter(value: 5)
    counter.reset()
    XCTAssertEqual(counter, Counter())
  }
}
