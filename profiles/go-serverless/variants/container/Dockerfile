FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/app .

FROM gcr.io/distroless/static-debian12:nonroot
ENV HOST=0.0.0.0 PORT=8080
COPY --from=build /out/app /app
USER nonroot
EXPOSE 8080
ENTRYPOINT ["/app"]
