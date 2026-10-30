import Hummingbird

public func greeting(_ name: String) -> String {
  "Hello, \(name.isEmpty ? "world" : name)!"
}

/// Routes of the service; tests drive them without a socket.
public func buildRouter() -> Router<BasicRequestContext> {
  let router = Router()
  router.get("health") { _, _ in "ok" }
  router.get("/") { _, _ in greeting("") }
  router.get("hello/:name") { _, context in
    greeting(context.parameters.get("name") ?? "")
  }
  return router
}

public func buildApplication(host: String, port: Int) -> some ApplicationProtocol {
  Application(
    router: buildRouter(),
    configuration: .init(address: .hostname(host, port: port)))
}
