// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "App",
    products: [.library(name: "App", targets: ["App"])],
    targets: [
        .target(name: "App"),
        .testTarget(name: "AppTests", dependencies: ["App"]),
    ]
)
