import AppCore
import Foundation

let environment = ProcessInfo.processInfo.environment
let host = environment["HOST"] ?? "127.0.0.1"
let port = Int(environment["PORT"] ?? "") ?? 8080
try await buildApplication(host: host, port: port).runService()
