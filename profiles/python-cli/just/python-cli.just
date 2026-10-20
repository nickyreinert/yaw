# profiles/python-cli: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.

# Create the uv environment (.venv) with the dev tools.
setup:
    uv sync

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
    uv run pytest

check: lint typecheck test audit

build:
    @echo "build: not applicable for python-cli (nothing is built; publish with uv build only with your approval)"

screenshot:
    @echo "screenshot: not applicable for python-cli"

preview:
    @echo "preview: not applicable for python-cli"

preview-share:
    @echo "preview-share: not applicable for python-cli"

# Vulnerability scan of the installed dependencies (needs network).
audit:
    uv run pip-audit

db-migrate:
    @echo "db-migrate: not applicable for python-cli"

db-reset:
    @echo "db-reset: not applicable for python-cli"

backup:
    @echo "backup: not applicable for python-cli"

restore:
    @echo "restore: not applicable for python-cli"

deploy env='':
    @echo "deploy: not applicable for python-cli (publishing to PyPI needs your approval)"
