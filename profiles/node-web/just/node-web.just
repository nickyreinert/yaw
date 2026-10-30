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

screenshot:
    @echo "screenshot: not applicable yet for node-web (browser screenshots need Playwright, not part of this profile)"

preview:
    @echo "preview: not applicable for node-web (use just dev)"

preview-share:
    @echo "preview-share: not applicable for node-web (share only with your approval)"

# Only shipped dependencies: everything in the scaffold is a dev tool.
audit:
    npm audit --omit=dev

db-migrate:
    @echo "db-migrate: not applicable for node-web (the scaffold has no database)"

db-reset:
    @echo "db-reset: not applicable for node-web (the scaffold has no database)"

backup:
    @echo "backup: not applicable for node-web"

restore:
    @echo "restore: not applicable for node-web"

deploy env='':
    @echo "deploy: not applicable for node-web (deploying and pushing images are remote and need your approval; add the command with your host)"
