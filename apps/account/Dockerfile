# 《掷富天下》业务服镜像（Go，静态编译；构建上下文为 apps/account）
FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN go vet ./... && go test ./... \
 && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /account .

FROM alpine:3.20
RUN adduser -D -u 1000 app && mkdir /data && chown app /data
USER app
ENV PORT=8080 DATA_FILE=/data/account.json
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
COPY --from=build /account /account
ENTRYPOINT ["/account"]
