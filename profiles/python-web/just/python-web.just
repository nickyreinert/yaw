# profiles/python-web: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` never needs Docker, a database or the network beyond uv/pip-audit (ADR-0035).

# Create the uv environment (.venv) with the dev tools; .env from .env.example (devenv module).
setup:
    uv sync
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

# Run the app with reload on http://127.0.0.1:8000.
dev:
    uv run uvicorn app.main:app --reload --app-dir src --host 127.0.0.1 --port 8000

fmt:
    uv run ruff format .

lint:
    uv run ruff check .
    uv run ruff format --check .
    uv run bandit -q -r src

typecheck:
    uv run pyright

test:
    uv run pytest

check: lint typecheck test audit sync-check

# Container image only (needs Docker); pushing it needs your approval.
build:
    docker build -t app .

screenshot:
    @echo "screenshot: not applicable yet for python-web (browser screenshots need Playwright, not part of this profile)"

preview:
    @echo "preview: not applicable for python-web (use just dev)"

preview-share:
    @echo "preview-share: not applicable for python-web (share only with your approval)"

# Vulnerability scan of the installed dependencies (needs network).
audit:
    uv run pip-audit

db-migrate:
    @echo "db-migrate: not applicable for python-web (the scaffold has no database; add alembic with an ADR)"

db-reset:
    @echo "db-reset: not applicable for python-web (the scaffold has no database)"

backup:
    @echo "backup: not applicable for python-web"

restore:
    @echo "restore: not applicable for python-web"

deploy env='':
    @echo "deploy: not applicable for python-web (deploying and pushing images are remote and need your approval; add the command with your host)"
