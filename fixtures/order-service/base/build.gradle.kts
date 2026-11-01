plugins {
    kotlin("jvm") version "2.2.0"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework:spring-web:6.2.0")
    implementation("org.springframework:spring-jdbc:6.2.0")
    testImplementation(kotlin("test"))
    testImplementation("io.mockk:mockk:1.14.0")
}
