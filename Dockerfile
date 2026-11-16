# 《掷富天下》一体化镜像：网页客户端 + Colyseus 对战服，同一端口（默认 2567）
# ---- 构建阶段（总在构建机原生架构上跑，产物与架构无关）----
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm test \
 && npm run build -w @dt/client \
 && npm run bundle -w @dt/server

# ---- 运行阶段：只有 node + 一个打包好的 js + 静态网页 ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=2567 STATIC_DIR=/app/public
WORKDIR /app
COPY --from=build /src/apps/server/dist/bundle.mjs ./server.mjs
COPY --from=build /src/apps/client/dist ./public
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server.mjs"]
