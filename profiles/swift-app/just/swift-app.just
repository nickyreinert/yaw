# profiles/swift-app: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Xcode project, signing, Docker or network (no third-party packages), T-001.

# Swift >= 6.0 (its toolchain ships `swift format`), then resolve the package.
setup:
    @command -v swift >/dev/null 2>&1 || { echo "setup: install Swift 6.0 or newer (https://swift.org/install)" >&2; exit 1; }
    @swift format --version >/dev/null 2>&1 || { echo "setup: this Swift toolchain has no 'swift format'; Swift 6.0 or newer is required" >&2; exit 1; }
    @swift --version
    swift package resolve

# Run the bare executable (opens the window on macOS; it is not a signed app bundle).
dev:
    swift run app

fmt:
    swift format --in-place --recursive Sources Tests Package.swift

lint:
    swift format lint --strict --recursive Sources Tests Package.swift

typecheck:
    swift build --build-tests

test:
    swift test

check: lint typecheck test sync-check

# Release build of the package. The shippable .app (signing, notarization, upload) comes from an Xcode app target and needs your approval.
build:
    swift build -c release

audit:
    @echo "audit: not applicable for swift-app (no third-party packages; SwiftPM has no audit command)"
