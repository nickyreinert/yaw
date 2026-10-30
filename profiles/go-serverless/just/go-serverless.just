# profiles/go-serverless: the core verbs (ADR-0120). `check` needs no Docker or AWS account; only Lambda needs the network once, to fetch aws-lambda-go (ADR-0123).

# Go toolchain and module dependencies (Lambda: aws-lambda-go, verified against the committed go.sum).
setup:
    @command -v go >/dev/null 2>&1 || { echo "setup: install Go 1.22 or newer (https://go.dev/dl/)" >&2; exit 1; }
    @go version
    go mod download

# Container flavor: serve on http://127.0.0.1:8080 (HOST and PORT override). Lambda flavor: no local server; just test covers the handler.
dev:
    @if grep -q aws-lambda-go go.mod; then echo "dev: the Lambda handler has no local server; run just test (deploying needs your approval)"; else go run .; fi

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

# Container: binary in bin/app; the image comes from the Dockerfile (docker build -t app ., needs Docker). Lambda: dist/bootstrap for linux/arm64 (zip it as the function package; deploying needs your approval).
build:
    @if grep -q aws-lambda-go go.mod; then CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -tags lambda.norpc -o dist/bootstrap .; else go build -o bin/app .; fi

# Known vulnerabilities in the standard library and modules with govulncheck (CI installs it; locally it is optional and installing it needs your approval).
audit:
    @if command -v govulncheck >/dev/null 2>&1; then govulncheck ./...; else echo "audit: govulncheck is not installed; skipped (CI runs it; installing it needs your approval)"; fi
