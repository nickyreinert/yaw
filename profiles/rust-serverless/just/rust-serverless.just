# profiles/rust-serverless: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker, AWS account or cargo-lambda, and no network beyond crates.io (ADR-0115).

# Cargo with rustfmt and clippy (rustup component add rustfmt clippy), then fetch the crates (creates Cargo.lock).
setup:
    @command -v cargo >/dev/null 2>&1 || { echo "setup: install Rust with rustup (https://rustup.rs/)" >&2; exit 1; }
    @cargo fmt --version >/dev/null 2>&1 || { echo "setup: install rustfmt with 'rustup component add rustfmt'" >&2; exit 1; }
    @cargo clippy --version >/dev/null 2>&1 || { echo "setup: install clippy with 'rustup component add clippy'" >&2; exit 1; }
    @cargo --version
    cargo fetch

# Container flavor: serve on http://127.0.0.1:8080 (HOST and PORT override). Lambda flavor: cargo lambda watch when cargo-lambda is installed (installing it needs your approval).
dev:
    @if grep -q lambda_http Cargo.toml; then if cargo lambda --version >/dev/null 2>&1; then cargo lambda watch; else echo "dev: install cargo-lambda to run the handler locally (needs your approval); just test covers the handler"; fi; else cargo run --quiet; fi

fmt:
    cargo fmt --all

lint:
    cargo fmt --all -- --check
    cargo clippy --all-targets -- -D warnings

typecheck:
    cargo check --all-targets

test:
    cargo test

check: lint typecheck test audit build sync-check

# Release binary in target/release/app. Container: the image comes from the Dockerfile (docker build -t app ., needs Docker). Lambda: cargo lambda build --release --arm64 (needs cargo-lambda). Pushing and deploying need your approval.
build:
    cargo build --release --locked

screenshot:
    @echo "screenshot: not applicable for rust-serverless"

preview:
    @echo "preview: not applicable for rust-serverless (use just dev)"

preview-share:
    @echo "preview-share: not applicable for rust-serverless"

# Vulnerability scan of Cargo.lock with cargo-audit (CI installs it; locally it is optional and installing it needs your approval).
audit:
    @if cargo audit --version >/dev/null 2>&1; then cargo audit; else echo "audit: cargo-audit is not installed; skipped (CI runs it; installing it needs your approval)"; fi

db-migrate:
    @echo "db-migrate: not applicable for rust-serverless"

db-reset:
    @echo "db-reset: not applicable for rust-serverless"

backup:
    @echo "backup: not applicable for rust-serverless"

restore:
    @echo "restore: not applicable for rust-serverless"

deploy env='':
    @echo "deploy: not applicable for rust-serverless (building images, cargo lambda deploy and cloud accounts need your approval)"
