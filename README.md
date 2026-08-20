# Zplit

Zplit is a self-hostable, owner-scoped ledger for shared expenses, friend balances, and repayments. It is designed for keeping an outing’s spending and the money received back understandable without turning the ledger into a social network.

## Current capabilities

- Multi-account ledgers with every record isolated to its owner.
- Friends, Trips, Outings, and outing-bound Expenses with whole-rupiah friend shares.
- Percentage charges, repayment records, payment methods, and manual, oldest-first, or newest-first allocation strategies.
- Allocation-safe Expense deletion can automatically reallocate affected repayment allocations oldest-first to other outstanding shares for the same friend; any unresolved remainder stays unallocated, while Repayment amounts remain unchanged.
- Private PostgreSQL-backed receipts, plus private temporary debtor balance links with selectable receipts.
- Copy, Preview, and QR sharing for balance links; invitation-only account creation.
- Global record search, amount search, URL-backed filters and pagination, history, and CSV exports.
- Light, dark, and system themes; installable PWA behavior with a static/offline fallback. Financial records are not available offline.

## Stack

Next.js App Router and server actions, React, TypeScript, Better Auth, Drizzle ORM, and PostgreSQL. Production runs as a non-root Next.js Docker container behind Caddy; the repository and domain rules form a modular monolith.

## Local setup

Prerequisites are Node.js 24.18 or newer, npm 11, and PostgreSQL. Install dependencies, configure the required `DB_*` and `BETTER_AUTH_*` environment values (secrets are read from files), apply migrations, and start the development server:

```sh
npm ci
npm run db:migrate
npm run dev
```

The application is invitation-only in normal operation. A local owner can be bootstrapped with the repository’s `scripts/bootstrap-owner.ts` tool when its secret-file environment is configured.

## Common commands

```sh
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
npm run test:deployment
npm run test:release
```

Focused domain, component, repository, security, and design/source-contract commands are listed in [Testing](docs/testing.md).

## Docker deployment basics

Compose keeps PostgreSQL on the internal `database` network and exposes the web service only to the neutral Caddy ingress network. Start the database, migrate it, then build and start the web service:

```sh
docker compose -f compose.yml up -d postgres
docker compose -f compose.yml build migrate
docker compose -f compose.yml --profile tools run --rm migrate
docker compose -f compose.yml build web
docker compose -f compose.yml up -d web
docker compose -f compose.yml ps
```

The production web container has no published host port; Caddy routes to it through the external `wildan-edge-zplit` network. The compose ingress address `172.25.0.19` is an intentional upstream contract and must not be changed casually. See [Operations](docs/operations.md) for deployment, backup, verification, rollback, and disposable fixture workflows.

## Security and privacy

Authentication is invitation-only, and Better Auth sessions are required for the private application. Server actions and repository queries carry the authenticated owner ID; PostgreSQL constraints reinforce owner isolation. Receipts are private database bytes served with no-store and restrictive response headers. Debtor links are seven-day bearer links whose random token is returned once and only its SHA-256 hash is stored. Private routes are non-indexable and non-cacheable, and the Caddy edge applies the site security headers. The current in-memory request limits assume one web container; shared rate-limit storage is required before horizontal scaling.

## Further reading

- [Architecture](docs/architecture.md)
- [Design system](docs/design-system.md)
- [Operations](docs/operations.md)
- [Testing](docs/testing.md)
- [Changelog](CHANGELOG.md)
