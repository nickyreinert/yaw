# profiles/node-app: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# Every framework variant (ADR-0105) has the npm scripts dev and build; `check` needs no Xcode, Android SDK or signing.

# Node >= 22.13, then the dev tools (npm install).
setup:
    @node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error(`Node >= 22.13 is required, found ${process.version}`); process.exit(1); }'
    npm install --no-audit --no-fund

dev:
    npm run dev

fmt:
    @echo "fmt: not applicable for node-app (no formatter; eslint --fix is optional: npx eslint --fix .)"

lint:
    npx eslint .

typecheck:
    npx tsc --noEmit

test:
    npx vitest run

check: lint typecheck test build audit sync-check

# The web/JS bundle of the chosen framework; native builds are run by you.
build:
    npm run build

# Shipped dependencies only.
audit:
    npm run audit
