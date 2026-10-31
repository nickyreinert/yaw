# profiles/node-web: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` never needs Docker, a database or the network beyond npm (T-001).

# Node >= 22.13, then the dev tools (npm install); the env file comes from its example (devenv module).
setup:
    @node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error(`Node >= 22.13 is required, found ${process.version}`); process.exit(1); }'
    npm install --no-audit --no-fund
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

# Build, then serve on http://127.0.0.1:3000 (HOST and PORT override).
dev:
    npm run build
    npm start

fmt:
    @echo "fmt: not applicable for node-web (no formatter; eslint --fix is optional: npx eslint --fix .)"

lint:
    npx eslint .

typecheck:
    npx tsc --noEmit

test:
    npx vitest run

check: lint typecheck test audit build sync-check

# Compile to dist/. The container image is built from the Dockerfile with docker build -t app . (needs Docker; pushing it needs your approval).
build:
    npm run build

# Only shipped dependencies: everything in the scaffold is a dev tool.
audit:
    npm audit --omit=dev
