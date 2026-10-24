# python-basic uniform verbs. The gate needs only the local Python toolchain.
setup:
    @command -v uv >/dev/null 2>&1 || { echo "setup: install uv (https://docs.astral.sh/uv/)" >&2; exit 1; }
    @command -v python3 >/dev/null 2>&1 || { echo "setup: install Python 3.11 or newer" >&2; exit 1; }
    uv sync

dev:
    uv run python src/app.py

fmt:
    @command -v uv >/dev/null 2>&1 || { echo "fmt: install uv" >&2; exit 1; }
    uv run ruff format .

lint:
    @command -v uv >/dev/null 2>&1 || { echo "lint: install uv" >&2; exit 1; }
    @uv run --no-sync ruff --version >/dev/null 2>&1 || { echo "lint: run 'just setup' to install Ruff" >&2; exit 1; }
    uv run ruff check .
    uv run ruff format --check .

typecheck:
    @command -v uv >/dev/null 2>&1 || { echo "typecheck: install uv" >&2; exit 1; }
    @uv run --no-sync pyright --version >/dev/null 2>&1 || { echo "typecheck: run 'just setup' to install Pyright" >&2; exit 1; }
    uv run pyright

test:
    @command -v uv >/dev/null 2>&1 || { echo "test: install uv" >&2; exit 1; }
    @uv run --no-sync pytest --version >/dev/null 2>&1 || { echo "test: run 'just setup' to install pytest" >&2; exit 1; }
    uv run pytest

check: lint typecheck test sync-check

build:
    @echo "build: not applicable for python-basic (no build step)"

screenshot:
    @echo "screenshot: not applicable for python-basic"

preview:
    @echo "preview: not applicable for python-basic"

preview-share:
    @echo "preview-share: not applicable for python-basic"

audit:
    @echo "audit: not applicable for python-basic (no dependency audit tool is included)"

db-migrate:
    @echo "db-migrate: not applicable for python-basic"

db-reset:
    @echo "db-reset: not applicable for python-basic"

backup:
    @echo "backup: not applicable for python-basic"

restore:
    @echo "restore: not applicable for python-basic"

deploy env='':
    @echo "deploy: not applicable for python-basic (deployment needs your approval)"
