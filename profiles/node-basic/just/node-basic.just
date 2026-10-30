# node-basic uniform verbs. No package installation is needed.
setup:
    @command -v node >/dev/null 2>&1 || { echo "setup: install Node.js >= 22.13" >&2; exit 1; }
    @node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error("setup: Node >= 22.13 is required, found " + process.version); process.exit(1); }'

dev:
    @echo "dev: not applicable for node-basic (run an entry file with node)"

fmt:
    @echo "fmt: not applicable for node-basic (no formatter without dependencies)"

lint:
    @command -v node >/dev/null 2>&1 || { echo "lint: install Node.js >= 22.13" >&2; exit 1; }
    @find src test -type f -name '*.js' -print | while read -r f; do node --check "$f" || exit 1; done

typecheck:
    @echo "typecheck: not applicable for node-basic (TypeScript checking needs a dependency)"

test:
    @command -v node >/dev/null 2>&1 || { echo "test: install Node.js >= 22.13" >&2; exit 1; }
    node --test

check: lint typecheck test audit sync-check

build:
    @echo "build: not applicable for node-basic (no build step)"

audit:
    @echo "audit: no dependencies, nothing to audit"
