# Build from the repository root: docker build -f packages/server/Dockerfile .
FROM oven/bun:1.4-alpine
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/extension/package.json packages/extension/
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @openticks/server

COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src

ENV NODE_ENV=production \
    PORT=8787 \
    OPENTICKS_DATA_DIR=/data
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["bun", "packages/server/src/index.ts"]
