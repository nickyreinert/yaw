# profiles/rust-cli: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker or network (no third-party crates), T-001.

# Cargo with rustfmt and clippy (rustup component add rustfmt clippy), then the lockfile.
setup:
    @command -v cargo >/dev/null 2>&1 || { echo "setup: install Rust with rustup (https://rustup.rs/)" >&2; exit 1; }
    @cargo fmt --version >/dev/null 2>&1 || { echo "setup: install rustfmt with 'rustup component add rustfmt'" >&2; exit 1; }
    @cargo clippy --version >/dev/null 2>&1 || { echo "setup: install clippy with 'rustup component add clippy'" >&2; exit 1; }
    @cargo --version
    cargo fetch

# Run the tool; arguments after the recipe name are passed on: just dev Ada.
dev *args:
    cargo run --quiet -- {{args}}

fmt:
    cargo fmt --all

lint:
    cargo fmt --all -- --check
    cargo clippy --all-targets -- -D warnings

typecheck:
    cargo check --all-targets

test:
    cargo test

check: lint typecheck test sync-check

build:
    cargo build --release

audit:
    @echo "audit: not applicable for rust-cli (no third-party crates; add cargo-audit with your approval once there are)"
