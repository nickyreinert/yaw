# java-basic uniform verbs; Gradle wrapper uses the installed JDK.
setup:
    @command -v java >/dev/null 2>&1 || { echo "setup: install JDK 17 or newer" >&2; exit 1; }
    @v=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1); if [ -z "$v" ] || [ "$v" -lt 17 ]; then echo "setup: JDK 17 or newer is required, found: ${v:-none}" >&2; exit 1; fi
    @test -f gradlew && test -f gradle/wrapper/gradle-wrapper.jar || { echo "setup: Gradle wrapper files are missing" >&2; exit 1; }
    chmod +x gradlew
    ./gradlew --version

dev:
    @echo "dev: not applicable for java-basic (no application host is configured)"

fmt:
    @echo "fmt: not applicable for java-basic (no formatter is included)"

lint:
    @command -v java >/dev/null 2>&1 || { echo "lint: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew compileJava compileTestJava

typecheck:
    @command -v java >/dev/null 2>&1 || { echo "typecheck: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew compileJava compileTestJava

test:
    @command -v java >/dev/null 2>&1 || { echo "test: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew test

check: lint typecheck test audit sync-check

build:
    @command -v java >/dev/null 2>&1 || { echo "build: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew build

screenshot:
    @echo "screenshot: not applicable for java-basic"

preview:
    @echo "preview: not applicable for java-basic"

preview-share:
    @echo "preview-share: not applicable for java-basic"

audit:
    @echo "audit: not applicable for java-basic (Dependabot can monitor Gradle dependencies)"

db-migrate:
    @echo "db-migrate: not applicable for java-basic"

db-reset:
    @echo "db-reset: not applicable for java-basic"

backup:
    @echo "backup: not applicable for java-basic"

restore:
    @echo "restore: not applicable for java-basic"

deploy env='':
    @echo "deploy: not applicable for java-basic (deployment needs your approval)"
