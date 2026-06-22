FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /bot ./fun-council

FROM alpine:3.21
COPY --from=build /bot /bot
CMD ["/bot"]
