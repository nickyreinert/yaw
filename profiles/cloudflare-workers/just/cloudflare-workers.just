# profiles/cloudflare-workers: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` makes no remote call: no deploy, no login, no Cloudflare API, no network beyond npm (ADR-0039).

# Wrangler sends no usage metrics from these recipes.
export WRANGLER_SEND_METRICS := "false"

# Node >= 22.13, then the dev tools (npm install); .dev.vars is yours to create, never written here.
setup:
    @node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error(`Node >= 22.13 is required, found ${process.version}`); process.exit(1); }'
    npm install --no-audit --no-fund
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

# Local Worker on http://localhost:8787 (Miniflare). Never --remote, never a binding with remote: true.
dev:
    npx wrangler dev --local

fmt:
    @echo "fmt: not applicable for cloudflare-workers (no formatter; eslint --fix is optional: npx eslint --fix .)"

lint:
    npx eslint .

# wrangler types writes worker-configuration.d.ts (local, git-ignored); then tsc.
typecheck:
    npx wrangler types
    npx tsc --noEmit

# Vitest in the Workers runtime (Miniflare, local).
test:
    npx vitest run

check: lint typecheck test audit sync-check

build:
    @echo "build: not applicable for cloudflare-workers (Wrangler bundles on deploy; the check never runs 'wrangler deploy --dry-run', ADR-0039)"

screenshot:
    @echo "screenshot: not applicable yet for cloudflare-workers (browser screenshots need Playwright, not part of this profile)"

preview:
    @echo "preview: not applicable for cloudflare-workers (use just dev)"

preview-share:
    @echo "preview-share: not applicable for cloudflare-workers (share only with your approval)"

# Only shipped dependencies: everything in the scaffold is a dev tool (ADR-0039).
audit:
    npm audit --omit=dev

db-migrate:
    @echo "db-migrate: not applicable yet for cloudflare-workers (the scaffold has no D1 database)"

db-reset:
    @echo "db-reset: not applicable for cloudflare-workers"

backup:
    @echo "backup: not applicable for cloudflare-workers"

restore:
    @echo "restore: not applicable for cloudflare-workers"

# Production deploy with Wrangler, only on your machine: refuses in CI, without the argument `prod`, and without YAW_CONFIRM_PROD=yes.
deploy env='':
    @if [ -n "${CI:-}" ]; then echo "deploy: refused, deploying runs on your machine only, never in CI" >&2; exit 1; fi
    @if [ "{{env}}" != "prod" ] || [ "${YAW_CONFIRM_PROD:-}" != "yes" ]; then echo "deploy: refused. Production only: YAW_CONFIRM_PROD=yes just deploy prod" >&2; exit 1; fi
    npx wrangler deploy
