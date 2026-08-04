FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /bridge ./misskey-mixi2-link

FROM alpine:3.21
COPY --from=build /bridge /bridge
CMD ["/bridge"]
