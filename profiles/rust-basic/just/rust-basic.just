# rust-basic uniform verbs; rustup provides rustfmt and clippy components.
setup:
    @command -v cargo >/dev/null 2>&1 || { echo "setup: install Rust with rustup (https://rustup.rs/)" >&2; exit 1; }
    @cargo --version

dev:
    @echo "dev: not applicable for rust-basic (run your Rust program directly)"

fmt:
    @command -v cargo >/dev/null 2>&1 || { echo "fmt: install Rust with rustup" >&2; exit 1; }
    @command -v rustfmt >/dev/null 2>&1 || { echo "fmt: install rustfmt with 'rustup component add rustfmt'" >&2; exit 1; }
    cargo fmt --all

lint:
    @command -v cargo >/dev/null 2>&1 || { echo "lint: install Rust with rustup" >&2; exit 1; }
    @command -v rustfmt >/dev/null 2>&1 || { echo "lint: install rustfmt with 'rustup component add rustfmt'" >&2; exit 1; }
    @cargo clippy --version >/dev/null 2>&1 || { echo "lint: install clippy with 'rustup component add clippy'" >&2; exit 1; }
    cargo fmt --all -- --check
    cargo clippy -q --all-targets -- -D warnings

typecheck:
    @command -v cargo >/dev/null 2>&1 || { echo "typecheck: install Rust with rustup" >&2; exit 1; }
    cargo check -q --all-targets

test:
    @command -v cargo >/dev/null 2>&1 || { echo "test: install Rust with rustup" >&2; exit 1; }
    cargo test -q

check: lint typecheck test audit sync-check

build:
    @command -v cargo >/dev/null 2>&1 || { echo "build: install Rust with rustup" >&2; exit 1; }
    cargo build -q

audit:
    @echo "audit: not applicable for rust-basic (no third-party crates)"
