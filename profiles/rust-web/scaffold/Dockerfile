FROM rust:1.96-slim-bookworm AS build
WORKDIR /srv
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN useradd --system --create-home app
WORKDIR /srv
ENV HOST=0.0.0.0 PORT=8080
COPY --from=build /srv/target/release/app /srv/app
USER app
EXPOSE 8080
CMD ["/srv/app"]
