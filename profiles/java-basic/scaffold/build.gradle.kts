plugins { java }

group = "com.example"
version = "0.0.0"

java { toolchain { languageVersion.set(JavaLanguageVersion.of(17)) } }

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.12.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.add("-Xlint:all")
}

tasks.test { useJUnitPlatform() }
