FROM eclipse-temurin:17-jdk-jammy AS build
WORKDIR /srv
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle ./gradle
COPY src ./src
RUN chmod +x gradlew && ./gradlew --no-daemon installDist

FROM eclipse-temurin:17-jre-jammy
RUN useradd --system --create-home app
WORKDIR /srv
ENV HOST=0.0.0.0 PORT=8080
COPY --from=build /srv/build/install/app /srv/app
USER app
EXPOSE 8080
CMD ["/srv/app/bin/app"]
