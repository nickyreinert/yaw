# profiles/java-cli: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs no Docker; the wrapper downloads Gradle and the libraries from Maven Central on first use (T-001, ADR-0125).

# JDK 17+ and the checked-in Gradle wrapper; downloads Gradle on first use.
setup:
    @command -v java >/dev/null 2>&1 || { echo "setup: install JDK 17 or newer" >&2; exit 1; }
    @v=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1); if [ -z "$v" ] || [ "$v" -lt 17 ]; then echo "setup: JDK 17 or newer is required, found: ${v:-none}" >&2; exit 1; fi
    @test -f gradlew && test -f gradle/wrapper/gradle-wrapper.jar || { echo "setup: Gradle wrapper files are missing" >&2; exit 1; }
    chmod +x gradlew
    ./gradlew --version

# Run the tool; arguments after the recipe name are passed on: just dev Ada.
dev *args:
    @command -v java >/dev/null 2>&1 || { echo "dev: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew --quiet run --args='{{args}}'

fmt:
    @command -v java >/dev/null 2>&1 || { echo "fmt: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew spotlessApply

lint:
    @command -v java >/dev/null 2>&1 || { echo "lint: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew spotlessCheck

typecheck:
    @command -v java >/dev/null 2>&1 || { echo "typecheck: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew compileJava compileTestJava

test:
    @command -v java >/dev/null 2>&1 || { echo "test: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew test

check: lint typecheck test build sync-check

# Runs the Gradle build and installs the launcher in build/install/app/bin/app.
build:
    @command -v java >/dev/null 2>&1 || { echo "build: install JDK 17 or newer" >&2; exit 1; }
    ./gradlew build installDist

audit:
    @echo "audit: not applicable for java-cli (Dependabot can monitor Gradle dependencies)"
