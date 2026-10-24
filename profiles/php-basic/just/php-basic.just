# php-basic uniform verbs; checks need only PHP and Composer-installed dev tools.
setup:
    @command -v php >/dev/null 2>&1 || { echo "setup: install PHP >= 8.2" >&2; exit 1; }
    @command -v composer >/dev/null 2>&1 || { echo "setup: install Composer 2" >&2; exit 1; }
    @php -r 'if (PHP_VERSION_ID < 80200) { fwrite(STDERR, "setup: PHP >= 8.2 is required, found " . PHP_VERSION . "\n"); exit(1); }'
    composer install --no-interaction --no-progress

dev:
    @echo "dev: not applicable for php-basic (this profile has no web entry point)"

fmt:
    @test -x vendor/bin/php-cs-fixer || { echo "fmt: run 'just setup' to install PHP-CS-Fixer" >&2; exit 1; }
    vendor/bin/php-cs-fixer fix

lint:
    @test -x vendor/bin/php-cs-fixer || { echo "lint: run 'just setup' to install PHP-CS-Fixer" >&2; exit 1; }
    vendor/bin/php-cs-fixer fix --dry-run --diff

typecheck:
    @test -x vendor/bin/phpstan || { echo "typecheck: run 'just setup' to install PHPStan" >&2; exit 1; }
    vendor/bin/phpstan analyse --no-progress

test:
    @test -x vendor/bin/phpunit || { echo "test: run 'just setup' to install PHPUnit" >&2; exit 1; }
    vendor/bin/phpunit

check: lint typecheck test audit sync-check

build:
    @echo "build: not applicable for php-basic (no build step)"

screenshot:
    @echo "screenshot: not applicable for php-basic"

preview:
    @echo "preview: not applicable for php-basic"

preview-share:
    @echo "preview-share: not applicable for php-basic"

audit:
    @command -v composer >/dev/null 2>&1 || { echo "audit: install Composer 2" >&2; exit 1; }
    @test -f composer.lock || { echo "audit: run 'just setup' to create composer.lock" >&2; exit 1; }
    composer audit --locked

db-migrate:
    @echo "db-migrate: not applicable for php-basic (no database)"

db-reset:
    @echo "db-reset: not applicable for php-basic (no database)"

backup:
    @echo "backup: not applicable for php-basic"

restore:
    @echo "restore: not applicable for php-basic"

deploy env='':
    @echo "deploy: not applicable for php-basic (deployment needs your approval)"
