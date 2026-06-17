# ---------- Etapa 1: build del frontend ----------
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build   # genera /app/dist (SPA + PWA)

# ---------- Etapa 2: runtime con PocketBase ----------
FROM alpine:3.20
ARG PB_VERSION=0.39.4
RUN apk add --no-cache ca-certificates unzip wget
WORKDIR /pb

RUN wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
  && unzip -q pocketbase_${PB_VERSION}_linux_amd64.zip \
  && rm pocketbase_${PB_VERSION}_linux_amd64.zip

# Esquema, hooks y frontend compilado (PocketBase sirve pb_public como SPA)
COPY pb/pb_migrations ./pb_migrations
COPY pb/pb_hooks ./pb_hooks
COPY --from=frontend /app/dist ./pb_public

EXPOSE 8080
# pb_data va en un volumen persistente (ver fly.toml). Una sola instancia (SQLite).
CMD ["./pocketbase", "serve", \
     "--http=0.0.0.0:8080", \
     "--dir=/pb/pb_data", \
     "--hooksDir=/pb/pb_hooks", \
     "--migrationsDir=/pb/pb_migrations", \
     "--publicDir=/pb/pb_public"]
