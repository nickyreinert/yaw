# profiles/java-web: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker or database; the wrapper downloads Gradle and the libraries from Maven Central on first use (T-001, ADR-0126).

# JDK 17+ and the checked-in Gradle wrapper; downloads Gradle on first use.
setup:
    @command -v java >/dev/null 2>&1 || { echo "setup: install JDK 17 or newer" >&2; exit 1; }
    @v=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1); if [ -z "$v" ] || [ "$v" -lt 17 ]; then echo "setup: JDK 17 or newer is required, found: ${v:-none}" >&2; exit 1; fi
    @test -f gradlew && test -f gradle/wrapper/gradle-wrapper.jar || { echo "setup: Gradle wrapper files are missing" >&2; exit 1; }
    chmod +x gradlew
    ./gradlew --version

# Serve on http://127.0.0.1:8080 (HOST and PORT override).
dev:
    @command -v java >/dev/null 2>&1 || { echo "dev: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew --quiet run

fmt:
    @command -v java >/dev/null 2>&1 || { echo "fmt: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew spotlessApply

lint:
    @command -v java >/dev/null 2>&1 || { echo "lint: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew --console=plain spotlessCheck

typecheck:
    @command -v java >/dev/null 2>&1 || { echo "typecheck: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew --console=plain compileJava compileTestJava

test:
    @command -v java >/dev/null 2>&1 || { echo "test: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew --console=plain test

check: lint typecheck test build sync-check

# Runs the Gradle build and installs the launcher in build/install/app/bin/app. The image comes from the Dockerfile (docker build -t app ., needs Docker); pushing and deploying need your approval.
build:
    @command -v java >/dev/null 2>&1 || { echo "build: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew --console=plain build installDist


audit:
    @echo "audit: not applicable for java-web (Dependabot can monitor Gradle dependencies)"
