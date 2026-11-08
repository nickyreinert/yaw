# profiles/kotlin-serverless: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker, AWS account or database; the wrapper downloads Gradle and the libraries from Maven Central on first use (T-001, ADR-0119).

# JDK 17+ and the checked-in Gradle wrapper; downloads Gradle on first use.
setup:
    @command -v java >/dev/null 2>&1 || { echo "setup: install JDK 17 or newer" >&2; exit 1; }
    @v=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1); if [ -z "$v" ] || [ "$v" -lt 17 ]; then echo "setup: JDK 17 or newer is required, found: ${v:-none}" >&2; exit 1; fi
    @test -f gradlew && test -f gradle/wrapper/gradle-wrapper.jar || { echo "setup: Gradle wrapper files are missing" >&2; exit 1; }
    chmod +x gradlew
    ./gradlew --version

# Container flavor: serve on http://127.0.0.1:8080 (HOST and PORT override). Lambda flavor: the handler has no local server; just test covers it.
dev:
    @command -v java >/dev/null 2>&1 || { echo "dev: install JDK 17 or newer" >&2; exit 1; }
    @if grep -q aws-lambda-java build.gradle.kts; then echo "dev: the Lambda handler has no local server; just test covers it (sam local needs your approval)"; else ./gradlew --quiet run; fi

fmt:
    @command -v java >/dev/null 2>&1 || { echo "fmt: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew ktlintFormat

lint:
    @command -v java >/dev/null 2>&1 || { echo "lint: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew --console=plain ktlintCheck

typecheck:
    @command -v java >/dev/null 2>&1 || { echo "typecheck: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew --console=plain compileKotlin compileTestKotlin

test:
    @command -v java >/dev/null 2>&1 || { echo "test: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew --console=plain test

check: lint typecheck test build sync-check

# Runs the Gradle build. Container: installs the launcher in build/install/app/bin/app; the image comes from the Dockerfile (docker build -t app ., needs Docker). Lambda: writes the zip to build/distributions/. Pushing and deploying need your approval.
build:
    @command -v java >/dev/null 2>&1 || { echo "build: install JDK 17 or newer" >&2; exit 1; }
    @if grep -q aws-lambda-java build.gradle.kts; then ./gradlew --console=plain build; else ./gradlew --console=plain build installDist; fi

audit:
    @echo "audit: not applicable for kotlin-serverless (Dependabot can monitor Gradle dependencies)"
