plugins {
    java
    id("com.diffplug.spotless") version "8.10.4"
    application
}

group = "com.example"
version = "0.0.0"

// Bytecode for Java 17 on any installed JDK 17+; no toolchain download needed.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

application { mainClass.set("com.example.app.Server") }

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.12.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// Warnings are errors: a lint finding fails compile, lint and typecheck alike.
tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

spotless { java { googleJavaFormat("1.28.0") } }

tasks.test { useJUnitPlatform() }
