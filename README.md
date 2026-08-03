# Zplit

Zplit is a self-hostable personal expense and repayment tracker.

## Current checkpoint

This checkpoint contains the frontend, private Docker deployment, PostgreSQL, and the initial debt-tracking schema. Authentication and application database usage are not implemented yet.

## Prerequisites

- Node.js 24.18 or newer
- npm 11

## Commands

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run lint
npm run build
```

## Private Docker deployment

The standalone Docker image runs Zplit as a non-root production process behind the shared Caddy ingress network. Zplit is publicly routed at `https://idr.wildan.lol`.

```sh
docker compose -f compose.yml build web
docker compose -f compose.yml up -d web
docker compose -f compose.yml ps
docker compose -f compose.yml logs -f web
```

No host port is published for the web or PostgreSQL services. PostgreSQL is private to the internal `database` network.

Start PostgreSQL and apply the schema:

```sh
docker compose -f compose.yml up -d postgres
docker compose -f compose.yml build migrate
docker compose -f compose.yml --profile tools run --rm migrate
docker compose -f compose.yml ps
```

The password is read from the ignored `secrets/postgres-password` file. Back it up securely; database backups are not implemented yet.

The initial schema is implemented, but authentication and application database queries are intentionally deferred to later checkpoints.
