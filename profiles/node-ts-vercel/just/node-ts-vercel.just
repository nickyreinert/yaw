# profiles/node-ts-vercel: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Vercel account, no deploy and no network beyond npm (ADR-0036).

# Node >= 22.13, then the dev tools (npm install); .env from .env.example (devenv module).
setup:
    @node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error(`Node >= 22.13 is required, found ${process.version}`); process.exit(1); }'
    npm install --no-audit --no-fund
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

dev:
    @echo "dev: not applicable yet for node-ts-vercel (the scaffold has no dev server; 'vercel dev' needs a Vercel login and is run by you, not the agent)"

fmt:
    @echo "fmt: not applicable for node-ts-vercel (no formatter; eslint --fix is optional: npx eslint --fix .)"

lint:
    npx eslint .

typecheck:
    npx tsc --noEmit

test:
    npx vitest run

check: lint typecheck test audit sync-check

build:
    @echo "build: not applicable for node-ts-vercel (Vercel builds on its side; 'tsc --noEmit' runs in just typecheck)"

screenshot:
    @echo "screenshot: not applicable yet for node-ts-vercel (browser screenshots need Playwright, not part of this profile)"

preview:
    @echo "preview: not applicable for node-ts-vercel"

preview-share:
    @echo "preview-share: not applicable for node-ts-vercel (share only with your approval)"

# Only shipped dependencies: everything in the scaffold is a dev tool (ADR-0036).
audit:
    npm audit --omit=dev

db-migrate:
    @echo "db-migrate: not applicable for node-ts-vercel"

db-reset:
    @echo "db-reset: not applicable for node-ts-vercel"

backup:
    @echo "backup: not applicable for node-ts-vercel"

restore:
    @echo "restore: not applicable for node-ts-vercel"

# Production deploy with the Vercel CLI, only on your machine: refuses in CI, without the argument `prod`, and without YAW_CONFIRM_PROD=yes.
deploy env='':
    @if [ -n "${CI:-}" ]; then echo "deploy: refused, deploying runs on your machine only, never in CI" >&2; exit 1; fi
    @if [ "{{env}}" != "prod" ] || [ "${YAW_CONFIRM_PROD:-}" != "yes" ]; then echo "deploy: refused. Production only: YAW_CONFIRM_PROD=yes just deploy prod" >&2; exit 1; fi
    npx --yes vercel@65.0.0 deploy --prod
