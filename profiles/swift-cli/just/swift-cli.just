# profiles/swift-cli: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker, Xcode project or network (no third-party packages), T-001.

# Swift >= 6.0 (its toolchain ships `swift format`), then resolve the package.
setup:
    @command -v swift >/dev/null 2>&1 || { echo "setup: install Swift 6.0 or newer (https://swift.org/install)" >&2; exit 1; }
    @swift format --version >/dev/null 2>&1 || { echo "setup: this Swift toolchain has no 'swift format'; Swift 6.0 or newer is required" >&2; exit 1; }
    @swift --version
    swift package resolve

# Run the tool; arguments after the recipe name are passed on: just dev Ada.
dev *args:
    swift run app {{args}}

fmt:
    swift format --in-place --recursive Sources Tests Package.swift

lint:
    swift format lint --strict --recursive Sources Tests Package.swift

typecheck:
    swift build --build-tests

test:
    swift test

check: lint typecheck test sync-check

build:
    swift build -c release

audit:
    @echo "audit: not applicable for swift-cli (no third-party packages; SwiftPM has no audit command)"
