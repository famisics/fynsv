FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /sync .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /sync /sync
ENTRYPOINT ["/sync"]
