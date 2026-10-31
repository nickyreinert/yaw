# profiles/python-vercel: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Vercel account, no deploy and no network beyond uv/pip-audit (T-001).

# Create the uv environment (.venv) with the dev tools; the env file comes from its example (devenv module).
setup:
    uv sync
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

dev:
    @echo "dev: not applicable yet for python-vercel (the scaffold has no dev server; the Vercel dev server needs a Vercel login and is run by you, not the agent)"

fmt:
    uv run ruff format .

lint:
    uv run ruff check .
    uv run ruff format --check .
    uv run bandit -q -r api

typecheck:
    uv run pyright

test:
    uv run pytest

check: lint typecheck test audit sync-check

build:
    @echo "build: not applicable for python-vercel (Vercel builds on its side)"

# Vulnerability scan of the installed dependencies (needs network).
audit:
    uv run pip-audit

# Production deploy with the Vercel CLI, only on your machine: refuses in CI, without the argument `prod`, and without YAW_CONFIRM_PROD=yes.
deploy env='':
    @if [ -n "${CI:-}" ]; then echo "deploy: refused, deploying runs on your machine only, never in CI" >&2; exit 1; fi
    @if [ "{{env}}" != "prod" ] || [ "${YAW_CONFIRM_PROD:-}" != "yes" ]; then echo "deploy: refused. Production only: YAW_CONFIRM_PROD=yes just deploy prod" >&2; exit 1; fi
    npx --yes vercel@65.0.0 deploy --prod
