# go-basic uniform verbs. The Go standard library is sufficient for the scaffold.
setup:
    @command -v go >/dev/null 2>&1 || { echo "setup: install Go 1.22 or newer" >&2; exit 1; }
    @go version

dev:
    @echo "dev: not applicable for go-basic (run your Go program directly)"

fmt:
    @command -v gofmt >/dev/null 2>&1 || { echo "fmt: install Go 1.22 or newer" >&2; exit 1; }
    gofmt -w .

lint:
    @command -v go >/dev/null 2>&1 || { echo "lint: install Go 1.22 or newer" >&2; exit 1; }
    @test -z "$(gofmt -l .)" || { echo "lint: run 'just fmt' to format Go files" >&2; exit 1; }
    go vet ./...
    @if command -v staticcheck >/dev/null 2>&1; then staticcheck ./...; else echo "lint: staticcheck is not installed; optional check skipped"; fi

typecheck:
    @command -v go >/dev/null 2>&1 || { echo "typecheck: install Go 1.22 or newer" >&2; exit 1; }
    go test -run '^$' ./...

test:
    @command -v go >/dev/null 2>&1 || { echo "test: install Go 1.22 or newer" >&2; exit 1; }
    go test ./...

check: lint typecheck test audit sync-check

build:
    @command -v go >/dev/null 2>&1 || { echo "build: install Go 1.22 or newer" >&2; exit 1; }
    go build ./...

screenshot:
    @echo "screenshot: not applicable for go-basic"

preview:
    @echo "preview: not applicable for go-basic"

preview-share:
    @echo "preview-share: not applicable for go-basic"

audit:
    @echo "audit: not applicable for go-basic (no third-party modules)"

db-migrate:
    @echo "db-migrate: not applicable for go-basic"

db-reset:
    @echo "db-reset: not applicable for go-basic"

backup:
    @echo "backup: not applicable for go-basic"

restore:
    @echo "restore: not applicable for go-basic"

deploy env='':
    @echo "deploy: not applicable for go-basic (deployment needs your approval)"
