import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.2.20"
    id("org.jlleitschuh.gradle.ktlint") version "13.1.0"
}

group = "com.example"
version = "0.0.0"

// Bytecode for Java 17 (the Lambda java17 and java21 runtimes) on any installed JDK 17+; no toolchain download needed.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    implementation("com.amazonaws:aws-lambda-java-core:1.4.1")
    implementation("com.amazonaws:aws-lambda-java-events:3.16.1")

    testImplementation(platform("org.junit:junit-bom:5.12.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform() }

// Deployment package for Lambda: classes at the top level, libraries in lib/ (build/distributions/app-<version>.zip).
val buildZip =
    tasks.register<Zip>("buildZip") {
        from(sourceSets.main.get().output)
        into("lib") { from(configurations.runtimeClasspath) }
    }

tasks.build { dependsOn(buildZip) }
