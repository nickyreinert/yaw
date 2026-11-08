# profiles/python-cli: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.

# Create the uv environment (.venv) with the dev tools; .env from .env.example (devenv module).
setup:
    uv sync
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

dev:
    uv run python src/app/main.py

fmt:
    uv run ruff format .

lint:
    uv run ruff check .
    uv run ruff format --check .

typecheck:
    uv run pyright

test:
    uv run pytest -q

check: lint typecheck test audit sync-check

build:
    @echo "build: not applicable for python-cli (nothing is built; publish with uv build only with your approval)"

# Vulnerability scan of the installed dependencies (needs network).
audit:
    uv run pip-audit
