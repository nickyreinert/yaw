# swift-basic uniform verbs. swift-format is optional in the installed Swift toolchain.
setup:
    @command -v swift >/dev/null 2>&1 || { echo "setup: install Swift 5.9 or newer" >&2; exit 1; }
    @swift --version
    swift package resolve

dev:
    @echo "dev: not applicable for swift-basic (run your Swift executable directly)"

fmt:
    @command -v swift >/dev/null 2>&1 || { echo "fmt: install Swift 5.9 or newer" >&2; exit 1; }
    @if command -v swift-format >/dev/null 2>&1; then swift-format format --in-place --recursive Sources Tests Package.swift; else echo "fmt: swift-format is not installed; formatting was not changed"; fi

lint:
    @command -v swift >/dev/null 2>&1 || { echo "lint: install Swift 5.9 or newer" >&2; exit 1; }
    @if command -v swift-format >/dev/null 2>&1; then swift-format lint --strict --recursive Sources Tests Package.swift; else echo "lint: swift-format is not installed; optional check skipped"; fi

typecheck:
    @command -v swift >/dev/null 2>&1 || { echo "typecheck: install Swift 5.9 or newer" >&2; exit 1; }
    swift build

test:
    @command -v swift >/dev/null 2>&1 || { echo "test: install Swift 5.9 or newer" >&2; exit 1; }
    swift test

check: lint typecheck test sync-check

build:
    @command -v swift >/dev/null 2>&1 || { echo "build: install Swift 5.9 or newer" >&2; exit 1; }
    swift build

screenshot:
    @echo "screenshot: not applicable for swift-basic"

preview:
    @echo "preview: not applicable for swift-basic"

preview-share:
    @echo "preview-share: not applicable for swift-basic"

audit:
    @echo "audit: not applicable for swift-basic (no external package dependencies)"

db-migrate:
    @echo "db-migrate: not applicable for swift-basic"

db-reset:
    @echo "db-reset: not applicable for swift-basic"

backup:
    @echo "backup: not applicable for swift-basic"

restore:
    @echo "restore: not applicable for swift-basic"

deploy env='':
    @echo "deploy: not applicable for swift-basic (deployment needs your approval)"
