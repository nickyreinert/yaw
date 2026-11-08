# profiles/android-kotlin: the uniform verbs (doc 01 §6). Verbs that do not apply print a note and exit 0.
# `check` needs the Android SDK (Android Lint and the compile need the platform jars) but no emulator, no device,
# no keystore and no store account; the network is only the Gradle distribution and Maven dependencies (ADR-0040).

# JDK >= 17 and an intact Gradle wrapper (no symlinks); then the wrapper is made executable. The SDK comes from ANDROID_HOME or local.properties (Gradle reports it if missing).
setup: _wrapper
    @v=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1); if [ -z "$v" ] || [ "$v" -lt 17 ]; then echo "setup: JDK 17 or newer is required, found: ${v:-none}" >&2; exit 1; fi
    chmod +x gradlew
    ./gradlew --version
    @if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env && echo "setup: created .env from .env.example, fill in the values"; fi

# Refuses a symlinked wrapper (script, jar, properties or their folders) before anything runs it.
_wrapper:
    @for p in gradlew gradle gradle/wrapper gradle/wrapper/gradle-wrapper.jar gradle/wrapper/gradle-wrapper.properties; do if [ -L "$p" ] || [ ! -e "$p" ]; then echo "$p: missing or a symbolic link; the Gradle wrapper must be plain files" >&2; exit 1; fi; done

# Debug build on the running emulator or the connected device (start the emulator yourself).
dev: _wrapper
    ./gradlew installDebug

fmt: _wrapper
    ./gradlew ktlintFormat

# ktlint, detekt and Android Lint on the debug variant.
lint: _wrapper
    ./gradlew --console=plain ktlintCheck detekt lintDebug

typecheck: _wrapper
    ./gradlew --console=plain compileDebugKotlin compileDebugUnitTestKotlin

# JUnit unit tests on the JVM (no emulator).
test: _wrapper
    ./gradlew --console=plain testDebugUnitTest

check: lint typecheck test sync-check

# Debug APK only. A release build is signed with your keystore, so it runs on your machine, not here (ADR-0040).
build: _wrapper
    ./gradlew --console=plain assembleDebug

audit:
    @echo "audit: not applicable for android-kotlin (doc 05 lists no dependency audit; Dependabot covers the Gradle versions)"
