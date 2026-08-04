FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY dist/swarm-gcal-sync/sync /sync
ENTRYPOINT ["/sync"]
