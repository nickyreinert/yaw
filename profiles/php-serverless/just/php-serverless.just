# profiles/php-serverless: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker, AWS credentials or SAM CLI, and no network beyond Composer/Packagist (ADR-0107).

# PHP >= 8.2 and Composer, then the dev tools (composer install).
setup:
    @php -r 'if (PHP_VERSION_ID < 80200) { fwrite(STDERR, "PHP >= 8.2 is required, found " . PHP_VERSION . "\n"); exit(1); }'
    composer install --no-interaction --no-progress

# Local server for the container flavor (PORT=8080); Bref has no local server, use just test.
dev:
    @if [ -f public/index.php ]; then php -S "127.0.0.1:${PORT:-8080}" -t public; else echo "dev: Bref runs on AWS Lambda; use just test (invoking locally needs the SAM CLI, run by you)"; fi

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
    @echo "build: not applicable for php-serverless (no build step; the container image or SAM package is built by you)"

# Vulnerability scan of the locked dependencies (needs network).
audit:
    composer audit --locked
