# Zplit

Zplit is a self-hostable personal expense and repayment tracker.

## Current checkpoint

This checkpoint contains the frontend and development foundation only. Database, authentication, and deployment are not implemented yet.

## Prerequisites

- Node.js 20.9+
- npm 10+

## Commands

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run lint
npm run build
```

## Private Docker deployment

The standalone Docker image runs Zplit as a non-root production process behind the shared Caddy ingress network.

```sh
docker compose -f compose.yml build web
docker compose -f compose.yml up -d web
docker compose -f compose.yml ps
docker compose -f compose.yml logs -f web
```

No host port is published. The service is available only through the shared external Caddy ingress network, and `idr.wildan.lol` is not routed in this checkpoint. PostgreSQL and authentication remain unimplemented.
