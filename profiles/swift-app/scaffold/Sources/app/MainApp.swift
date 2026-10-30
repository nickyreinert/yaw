import AppCore

#if canImport(SwiftUI)
  import SwiftUI

  struct ContentView: View {
    @State private var counter = Counter()

    var body: some View {
      VStack(spacing: 12) {
        Text(counter.title)
        HStack {
          Button("Add") { counter.increment() }
          Button("Reset") { counter.reset() }
        }
      }
      .padding(40)
    }
  }

  @main
  struct MainApp: App {
    var body: some Scene {
      WindowGroup {
        ContentView()
      }
    }
  }
#else
  // SwiftUI exists on Apple platforms only; elsewhere this target prints a note so the package still builds.
  @main
  struct MainApp {
    static func main() {
      print(Counter().title + " (the window needs macOS with SwiftUI)")
    }
  }
#endif
