/// App logic without any UI framework, so it builds and tests on every platform.
public struct Counter: Equatable {
  public private(set) var value: Int

  public init(value: Int = 0) {
    self.value = value
  }

  public mutating func increment() {
    value += 1
  }

  public mutating func reset() {
    value = 0
  }

  public var title: String {
    value == 0 ? "Tap to start" : "Tapped \(value) \(value == 1 ? "time" : "times")"
  }
}
