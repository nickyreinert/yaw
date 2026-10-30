// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "app",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "AppCore"),
    .executableTarget(name: "app", dependencies: ["AppCore"]),
    .testTarget(name: "AppCoreTests", dependencies: ["AppCore"]),
  ]
)
