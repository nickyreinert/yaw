# git-hooks module (ADR-0026): lefthook runs just fmt, just lint and gitleaks on every commit.

# Install the lefthook git hooks into this clone (once per clone).
hooks-install:
    @if command -v lefthook >/dev/null 2>&1; then lefthook install; else echo "hooks-install: lefthook is not installed (brew install lefthook, or see https://lefthook.dev/installation/)"; exit 1; fi

# Remove the lefthook git hooks from this clone.
hooks-uninstall:
    @if command -v lefthook >/dev/null 2>&1; then lefthook uninstall; else echo "hooks-uninstall: lefthook is not installed, nothing to remove"; fi
