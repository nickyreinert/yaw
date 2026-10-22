# profiles/php-web: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker, database or Playwright, and no network beyond Composer/Packagist (ADR-0037).

# PHP >= 8.2 and Composer, then the dev tools (composer install); .env from .env.example (devenv module).
setup:
    @php -r 'if (PHP_VERSION_ID < 80200) { fwrite(STDERR, "PHP >= 8.2 is required, found " . PHP_VERSION . "\n"); exit(1); }'
    composer install --no-interaction --no-progress
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

# Run the built-in PHP server on http://127.0.0.1:8000.
dev:
    php -S 127.0.0.1:8000 -t public

fmt:
    vendor/bin/php-cs-fixer fix

lint:
    vendor/bin/php-cs-fixer fix --dry-run --diff

typecheck:
    vendor/bin/phpstan analyse --no-progress

test:
    vendor/bin/phpunit

check: lint typecheck test audit sync-check

build:
    @echo "build: not applicable for php-web (no build step; a container image comes with the compose setup)"

screenshot:
    @echo "screenshot: not applicable yet for php-web (browser screenshots need Playwright, not part of this profile)"

preview:
    @echo "preview: not applicable for php-web (use just dev)"

preview-share:
    @echo "preview-share: not applicable for php-web (share only with your approval)"

# Vulnerability scan of the locked dependencies (needs network).
audit:
    composer audit --locked

db-migrate:
    @echo "db-migrate: not applicable for php-web (the scaffold has no database; 'artisan migrate --pretend' comes with Laravel)"

db-reset:
    @echo "db-reset: not applicable for php-web (the scaffold has no database)"

backup:
    @echo "backup: not applicable for php-web"

restore:
    @echo "restore: not applicable for php-web"

deploy env='':
    @echo "deploy: not applicable for php-web (rsync/SFTP to a host and migrations are remote and need your approval; add the command with your host)"
