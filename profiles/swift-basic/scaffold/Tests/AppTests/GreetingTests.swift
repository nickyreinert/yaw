import XCTest
@testable import App

final class GreetingTests: XCTestCase {
    func testGreetsByName() {
        XCTAssertEqual(greeting("Ada"), "Hello, Ada!")
    }
}
