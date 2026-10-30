// swift-tools-version: 6.1
import PackageDescription

let package = Package(
  name: "app",
  platforms: [.macOS(.v14)],
  dependencies: [
    .package(url: "https://github.com/hummingbird-project/hummingbird.git", exact: "2.26.0")
  ],
  targets: [
    .target(
      name: "AppCore",
      dependencies: [.product(name: "Hummingbird", package: "hummingbird")]),
    .executableTarget(name: "app", dependencies: ["AppCore"]),
    .testTarget(
      name: "AppCoreTests",
      dependencies: [
        "AppCore",
        .product(name: "HummingbirdTesting", package: "hummingbird"),
      ]),
  ]
)
