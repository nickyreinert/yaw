# profiles/php-cli: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker or database, and no network beyond Composer/Packagist (T-001).

# PHP >= 8.2 and Composer, then the dev tools (composer install).
setup:
    @php -r 'if (PHP_VERSION_ID < 80200) { fwrite(STDERR, "PHP >= 8.2 is required, found " . PHP_VERSION . "\n"); exit(1); }'
    composer install --no-interaction --no-progress

# Run the tool; arguments after the recipe name are passed on: just dev Ada.
dev *args:
    php bin/app {{args}}

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
    @echo "build: not applicable for php-cli (no build step; a PHAR is optional and comes with an ADR)"

screenshot:
    @echo "screenshot: not applicable for php-cli"

preview:
    @echo "preview: not applicable for php-cli (use just dev)"

preview-share:
    @echo "preview-share: not applicable for php-cli"

# Vulnerability scan of the locked dependencies (needs network).
audit:
    composer audit --locked

db-migrate:
    @echo "db-migrate: not applicable for php-cli"

db-reset:
    @echo "db-reset: not applicable for php-cli"

backup:
    @echo "backup: not applicable for php-cli"

restore:
    @echo "restore: not applicable for php-cli"

deploy env='':
    @echo "deploy: not applicable for php-cli (a local tool; installing or copying it elsewhere needs your approval)"
