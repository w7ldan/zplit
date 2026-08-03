FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS builder

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM dependencies AS migrator

WORKDIR /app
COPY drizzle ./drizzle
COPY scripts/migrate.ts ./scripts/migrate.ts
USER node
CMD ["./node_modules/.bin/tsx", "scripts/migrate.ts"]

FROM dependencies AS auth-tool

WORKDIR /app
COPY src/auth/factory.ts ./src/auth/factory.ts
COPY src/auth/runtime.ts ./src/auth/runtime.ts
COPY src/db/client.ts ./src/db/client.ts
COPY src/db/schema.ts ./src/db/schema.ts
COPY src/server/secret-file.ts ./src/server/secret-file.ts
COPY scripts/bootstrap-owner.ts ./scripts/bootstrap-owner.ts
USER node
CMD ["./node_modules/.bin/tsx", "scripts/bootstrap-owner.ts"]

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
