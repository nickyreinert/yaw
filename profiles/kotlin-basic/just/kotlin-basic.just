# kotlin-basic uniform verbs; the wrapper downloads Gradle on first use.
setup:
    @command -v java >/dev/null 2>&1 || { echo "setup: install JDK 17 or newer" >&2; exit 1; }
    @v=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1); if [ -z "$v" ] || [ "$v" -lt 17 ]; then echo "setup: JDK 17 or newer is required, found: ${v:-none}" >&2; exit 1; fi
    @test -f gradlew && test -f gradle/wrapper/gradle-wrapper.jar || { echo "setup: Gradle wrapper files are missing" >&2; exit 1; }
    chmod +x gradlew
    ./gradlew --version

dev:
    @echo "dev: not applicable for kotlin-basic (no application host is configured)"

fmt:
    @command -v java >/dev/null 2>&1 || { echo "fmt: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew ktlintFormat

lint:
    @command -v java >/dev/null 2>&1 || { echo "lint: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew ktlintCheck

typecheck:
    @command -v java >/dev/null 2>&1 || { echo "typecheck: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew compileKotlin compileTestKotlin

test:
    @command -v java >/dev/null 2>&1 || { echo "test: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew test

check: lint typecheck test sync-check

build:
    @command -v java >/dev/null 2>&1 || { echo "build: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew build

screenshot:
    @echo "screenshot: not applicable for kotlin-basic"

preview:
    @echo "preview: not applicable for kotlin-basic"

preview-share:
    @echo "preview-share: not applicable for kotlin-basic"

audit:
    @echo "audit: not applicable for kotlin-basic (Dependabot can monitor Gradle dependencies)"

db-migrate:
    @echo "db-migrate: not applicable for kotlin-basic"

db-reset:
    @echo "db-reset: not applicable for kotlin-basic"

backup:
    @echo "backup: not applicable for kotlin-basic"

restore:
    @echo "restore: not applicable for kotlin-basic"

deploy env='':
    @echo "deploy: not applicable for kotlin-basic (deployment needs your approval)"
