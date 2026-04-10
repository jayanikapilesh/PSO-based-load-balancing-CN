FROM golang:1.21-alpine

# Install docker CLI so we can trigger docker commands
RUN apk add --no-cache docker-cli

WORKDIR /app

COPY main.go .
RUN go mod init healer && go build -o healer main.go

CMD ["./healer"]
