# profiles/static-site: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.

# Node >= 22.13, then the linters (npm install); .env from .env.example (devenv module).
setup:
    @node -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error(`Node >= 22.13 is required, found ${process.version}`); process.exit(1); }'
    npm install --no-audit --no-fund
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

# Serve public/ on http://localhost:3000.
dev:
    npx serve public

fmt:
    @echo "fmt: not applicable for static-site (stylelint --fix is optional: npx stylelint --fix 'public/**/*.css')"

lint:
    npx html-validate public
    npx stylelint 'public/**/*.css'

typecheck:
    @echo "typecheck: not applicable for static-site"

# Local links, anchors and assets of every page resolve (no network).
test:
    node scripts/check-links.mjs

check: lint typecheck test audit sync-check

build:
    @echo "build: not applicable for static-site (public/ is the build output; add a build step only with an ADR)"

screenshot:
    @echo "screenshot: not applicable yet for static-site (browser screenshots need Playwright, not part of this profile)"

preview:
    npx serve public

preview-share:
    @echo "preview-share: not applicable for static-site (share only with your approval)"

# Only shipped dependencies: the site is static files, linters are dev tools (ADR-0034).
audit:
    npm audit --omit=dev

db-migrate:
    @echo "db-migrate: not applicable for static-site"

db-reset:
    @echo "db-reset: not applicable for static-site"

backup:
    @echo "backup: not applicable for static-site"

restore:
    @echo "restore: not applicable for static-site"

deploy env='':
    @echo "deploy: not applicable for static-site (deploying is remote and needs your approval; add the command with your host)"
