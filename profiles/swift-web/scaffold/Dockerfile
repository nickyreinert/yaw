FROM swift:6.1 AS build
WORKDIR /srv
COPY Package.swift Package.resolved ./
RUN swift package resolve
COPY Sources ./Sources
RUN swift build -c release --static-swift-stdlib

FROM ubuntu:24.04
RUN useradd --system --create-home app
WORKDIR /srv
ENV HOST=0.0.0.0 PORT=8080
COPY --from=build /srv/.build/release/app /srv/app
USER app
EXPOSE 8080
CMD ["/srv/app"]
