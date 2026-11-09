# profiles/wordpress-plugin: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker, WordPress download or database, and no network beyond Composer/Packagist (ADR-0038).

# PHP >= 8.2 and Composer, then the dev tools (composer install); .env from .env.example (devenv module).
setup:
    @php -r 'if (PHP_VERSION_ID < 80200) { fwrite(STDERR, "PHP >= 8.2 is required, found " . PHP_VERSION . "\n"); exit(1); }'
    composer install --no-interaction --no-progress
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

# Local WordPress with wp-env (needs Docker; downloads WordPress on first start), http://localhost:8888.
# Plugin Check (WordPress.org review rules) is not a verb: in this site run `npx @wordpress/env run cli wp plugin install plugin-check --activate`, then `npx @wordpress/env run cli wp plugin check <plugin folder>` (ADR-0038).
dev:
    npx --yes @wordpress/env@12.0.0 start

fmt:
    vendor/bin/phpcbf

lint:
    vendor/bin/phpcs

typecheck:
    vendor/bin/phpstan analyse --no-progress --memory-limit=1G

test:
    vendor/bin/phpunit --no-progress

check: lint typecheck test audit sync-check

build:
    @echo "build: not applicable for wordpress-plugin (no build step; the ZIP release is made by you)"

# Vulnerability scan of the locked dependencies (needs network).
audit:
    composer audit --locked
