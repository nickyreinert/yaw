import Hummingbird
import HummingbirdTesting
import XCTest

@testable import AppCore

final class AppTests: XCTestCase {
  func testHealthIsOk() async throws {
    let app = Application(router: buildRouter())
    try await app.test(.router) { client in
      try await client.execute(uri: "/health", method: .get) { response in
        XCTAssertEqual(response.status, .ok)
        XCTAssertEqual(String(buffer: response.body), "ok")
      }
    }
  }

  func testGreetsByName() async throws {
    let app = Application(router: buildRouter())
    try await app.test(.router) { client in
      try await client.execute(uri: "/hello/Ada", method: .get) { response in
        XCTAssertEqual(String(buffer: response.body), "Hello, Ada!")
      }
    }
  }

  func testRootGreetsTheWorld() async throws {
    let app = Application(router: buildRouter())
    try await app.test(.router) { client in
      try await client.execute(uri: "/", method: .get) { response in
        XCTAssertEqual(String(buffer: response.body), "Hello, world!")
      }
    }
  }

  func testUnknownRouteIsNotFound() async throws {
    let app = Application(router: buildRouter())
    try await app.test(.router) { client in
      try await client.execute(uri: "/nope", method: .get) { response in
        XCTAssertEqual(response.status, .notFound)
      }
    }
  }
}
