# profiles/go-web: the core verbs (ADR-0120). `check` never needs Docker or a database, and no network (standard library only), T-001.

# Go toolchain and module dependencies (none until you add some).
setup:
    @command -v go >/dev/null 2>&1 || { echo "setup: install Go 1.22 or newer (https://go.dev/dl/)" >&2; exit 1; }
    @go version
    go mod download

# Serve on http://127.0.0.1:8080 (HOST and PORT override).
dev:
    go run .

fmt:
    gofmt -w .

lint:
    @test -z "$(gofmt -l .)" || { echo "lint: run 'just fmt' to format Go files:" >&2; gofmt -l . >&2; exit 1; }
    go vet ./...
    @if command -v staticcheck >/dev/null 2>&1; then staticcheck ./...; else echo "lint: staticcheck is not installed; optional check skipped"; fi

# Compiles the packages and their tests without running them.
typecheck:
    go build ./...
    go test -run '^$' ./...

test:
    go test ./...

check: lint typecheck test audit build sync-check

# Binary in bin/app. The container image is built from the Dockerfile with docker build -t app . (needs Docker; pushing it needs your approval).
build:
    go build -o bin/app .

# Known vulnerabilities in the standard library and modules with govulncheck (CI installs it; locally it is optional and installing it needs your approval).
audit:
    @if command -v govulncheck >/dev/null 2>&1; then govulncheck ./...; else echo "audit: govulncheck is not installed; skipped (CI runs it; installing it needs your approval)"; fi
