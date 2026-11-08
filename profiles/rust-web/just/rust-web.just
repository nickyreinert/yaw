# profiles/rust-web: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` never needs Docker or a database, and no network beyond crates.io (T-001).

# Cargo with rustfmt and clippy (rustup component add rustfmt clippy), then fetch the crates (creates Cargo.lock).
setup:
    @command -v cargo >/dev/null 2>&1 || { echo "setup: install Rust with rustup (https://rustup.rs/)" >&2; exit 1; }
    @cargo fmt --version >/dev/null 2>&1 || { echo "setup: install rustfmt with 'rustup component add rustfmt'" >&2; exit 1; }
    @cargo clippy --version >/dev/null 2>&1 || { echo "setup: install clippy with 'rustup component add clippy'" >&2; exit 1; }
    @cargo --version
    cargo fetch

# Serve on http://127.0.0.1:8080 (HOST and PORT override).
dev:
    cargo run --quiet

fmt:
    cargo fmt --all

lint:
    cargo fmt --all -- --check
    cargo clippy -q --all-targets -- -D warnings

typecheck:
    cargo check -q --all-targets

test:
    cargo test -q

check: lint typecheck test audit build sync-check

# Release binary in target/release/app. The container image is built from the Dockerfile with docker build -t app . (needs Docker; pushing it needs your approval).
build:
    cargo build -q --release --locked

# Vulnerability scan of Cargo.lock with cargo-audit (CI installs it; locally it is optional and installing it needs your approval).
audit:
    @if cargo audit --version >/dev/null 2>&1; then cargo audit; else echo "audit: cargo-audit is not installed; skipped (CI runs it; installing it needs your approval)"; fi
