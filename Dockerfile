# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/phantomforce-desktop/package.json packages/phantomforce-desktop/package.json
COPY server/package.json server/package.json
RUN npm ci

FROM deps AS build
COPY packages packages
COPY server server
COPY app app
COPY downloads downloads
RUN npm run prisma:generate --workspace @phantomforce/server \
  && npm run build --workspace @phantomforce/contracts \
  && npm run build --workspace @phantomforce/server \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=5190 \
  PHANTOMFORCE_SERVER_LOGGER=true \
  PHANTOMFORCE_DEPLOYMENT_TARGET=coolify
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system phantomforce && useradd --system --gid phantomforce --home /app phantomforce \
  && mkdir -p /data/phantomforce /app/.phantom /app/server/.local \
  && chown -R phantomforce:phantomforce /data/phantomforce /app
COPY --from=build --chown=phantomforce:phantomforce /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build --chown=phantomforce:phantomforce /app/node_modules node_modules
COPY --from=build --chown=phantomforce:phantomforce /app/packages packages
COPY --from=build --chown=phantomforce:phantomforce /app/server/package.json server/package.json
COPY --from=build --chown=phantomforce:phantomforce /app/server/dist server/dist
COPY --from=build --chown=phantomforce:phantomforce /app/server/prisma server/prisma
COPY --from=build --chown=phantomforce:phantomforce /app/app app
COPY --from=build --chown=phantomforce:phantomforce /app/downloads downloads
USER phantomforce
EXPOSE 5190
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:5190/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
