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

# Vulnerability scan of the installed dependencies (needs network).
audit:
    uv run pip-audit
