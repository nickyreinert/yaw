# profiles/node-static: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs nothing beyond npm (T-001).

# Node >= 22.13, then the dev tools (npm install).
setup:
    @node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error(`Node >= 22.13 is required, found ${process.version}`); process.exit(1); }'
    npm install --no-audit --no-fund

# Vite dev server with hot reload.
dev:
    npm run dev

fmt:
    @echo "fmt: not applicable for node-static (no formatter; eslint --fix is optional: npx eslint --fix .)"

lint:
    npx eslint .

typecheck:
    npx tsc --noEmit

test:
    npx vitest run --reporter=dot

check: lint typecheck test audit build sync-check

# Bundle to dist/; upload that folder to your static host (hosting is yours).
build:
    npm run build

# Only shipped dependencies: the scaffold has none (Vite bundles the code, everything else is a dev tool).
audit:
    npm audit --omit=dev
