# Elektroplaner – Container für Unraid, NAS oder Server
# Stufe 1: App bauen
FROM --platform=$BUILDPLATFORM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx vite build

# Stufe 2: nur Node + gebaute App + kleiner Server (keine npm-Pakete nötig)
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist DATA_DIR=/data PUID=1000 PGID=1000
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server/server.mjs ./server/server.mjs
RUN mkdir -p /data
# Startet als root, übergibt /data an PUID:PGID und läuft dann als dieser Benutzer (siehe server.mjs)
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/server.mjs"]
