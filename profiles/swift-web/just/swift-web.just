# profiles/swift-web: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` never needs Docker or a database, and no network beyond SwiftPM fetching packages (T-001).

# Swift >= 6.1 (its toolchain ships `swift format`), then resolve the packages.
setup:
    @command -v swift >/dev/null 2>&1 || { echo "setup: install Swift 6.1 or newer (https://swift.org/install)" >&2; exit 1; }
    @swift format --version >/dev/null 2>&1 || { echo "setup: this Swift toolchain has no 'swift format'; Swift 6.1 or newer is required" >&2; exit 1; }
    @swift --version
    swift package resolve

# Serve on http://127.0.0.1:8080 (HOST and PORT override).
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

check: lint typecheck test audit build sync-check

# Release binary in .build/release/app. The container image is built from the Dockerfile with docker build -t app . (needs Docker; pushing it needs your approval).
build:
    swift build -c release

audit:
    @echo "audit: not applicable for swift-web (SwiftPM has no audit command; dependencies are pinned in Package.resolved and watched by Dependabot)"
