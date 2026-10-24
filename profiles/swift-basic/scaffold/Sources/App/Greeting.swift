public func greeting(_ name: String) -> String {
    "Hello, \(name.isEmpty ? "world" : name)!"
}
