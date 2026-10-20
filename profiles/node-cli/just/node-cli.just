# profiles/node-cli: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.

# Node >= 22.13, then install dependencies only if package.json lists any.
setup:
    @node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error(`Node >= 22.13 is required, found ${process.version}`); process.exit(1); }'
    @if [ "$(node -p 'const p = require("./package.json"); Object.keys({ ...p.dependencies, ...p.devDependencies }).length')" != "0" ]; then npm install --no-audit --no-fund; else echo "setup: Node $(node --version), no dependencies to install"; fi

dev:
    @if [ -f src/index.js ]; then node --watch src/index.js; else echo "dev: no src/index.js; run your entry file with node"; fi

fmt:
    @echo "fmt: not applicable for node-cli (no formatter without dependencies)"

# Syntax check of every .js/.mjs file; shell scripts through shellcheck when it is installed.
lint:
    @find . \( -name .git -o -name node_modules -o -name .yaw \) -prune -o \( -name '*.js' -o -name '*.mjs' \) -type f -print | while read -r f; do node --check "$f" || exit 1; done
    @if [ -n "$(find . \( -name .git -o -name node_modules -o -name .yaw \) -prune -o -name '*.sh' -type f -print)" ]; then if command -v shellcheck >/dev/null 2>&1; then find . \( -name .git -o -name node_modules -o -name .yaw \) -prune -o -name '*.sh' -type f -print | while read -r f; do shellcheck "$f" || exit 1; done; else echo "lint: shellcheck is not installed, shell scripts were not checked"; fi; fi

typecheck:
    @echo "typecheck: not applicable for node-cli (tsc --checkJs is optional and needs a dependency)"

test:
    npm test

check: lint typecheck test audit

build:
    @echo "build: not applicable for node-cli (no build step; a release is a git tag)"

screenshot:
    @echo "screenshot: not applicable for node-cli"

preview:
    @echo "preview: not applicable for node-cli"

preview-share:
    @echo "preview-share: not applicable for node-cli"

# npm audit only when there are dependencies (needs network then).
audit:
    @if [ "$(node -p 'const p = require("./package.json"); Object.keys({ ...p.dependencies, ...p.devDependencies }).length')" != "0" ]; then npm audit; else echo "audit: no dependencies, nothing to audit"; fi

db-migrate:
    @echo "db-migrate: not applicable for node-cli"

db-reset:
    @echo "db-reset: not applicable for node-cli"

backup:
    @echo "backup: not applicable for node-cli"

restore:
    @echo "restore: not applicable for node-cli"

deploy env='':
    @echo "deploy: not applicable for node-cli (a release is a git tag, pushed only with your approval)"
