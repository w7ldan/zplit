# Zplit

Zplit is a personal and collaborative financial record for keeping shared money understandable over time.

I kept paying for friends and then forgetting who still owed what, so I built Zplit around the way I actually wanted to keep track of shared money.

[Live app](https://idr.wildan.lol) · [GitHub repository](https://github.com/w7ldan/zplit) · [Architecture](docs/architecture.md) · [Local setup](#running-locally)

> **Showcase visual placeholder** — a future privacy-safe composition can sit here, covering the product journey from Personal records to Groups, Organizations, and a private share link. No production screenshots or personal data are included yet.

The live application is invite-only in normal operation; this repository does not provide a public demo account or promise open signup.

## Why Zplit exists

Shared expenses are easy to record and surprisingly hard to explain later. Zplit is built around the full trail: who was involved, what happened, how a cost was divided, what was repaid, and which historical facts still matter.

It started as a way to remember personal debts. It has grown into a coherent product for day-to-day financial tracking across three deliberately different contexts—not a single generic workspace and not just a CRUD expense form.

## Product tour

The intended future visual sequence is: **Hero → Personal → Group → Organization → private share link**. The sections below describe the real product surfaces without exposing production data.

### Personal

The original owner-centric ledger for everyday shared spending:

- Friends, Trips, Outings, Expenses, and explicit friend shares;
- Repayments with payment methods, allocation history, and balance summaries;
- receipts, searchable history, CSV exports, and contextual trip balances;
- private sharing for a recipient who needs to see a selected balance or receipt context.

### Groups

Groups are fundamentally peer-to-peer accounting. A registered participant may pay, owe, or be owed; an external participant can remain a debtor without a Zplit account. Expenses have a confirmation lifecycle where needed, so a pending payer claim does not silently change the authoritative balance.

When money moves, a Group can record a payment settlement. When reciprocal obligations are explicitly cancelled without money moving, it can record an offset settlement. Chat, Inbox notifications, unread state, and read receipts keep the collaborative context attached to the ledger.

### Organizations

Organizations are scoped collaborative financial workspaces. They extend the owner/entity-centric ledger model with durable participants and members, Friends, Trips, Outings, Expenses, Repayments, exports, and mature history/evidence features. Access is governed by capability-based permissions, and each Organization has its own General Chat.

### Private sharing

A private share link lets an owner intentionally expose a read-only balance statement to a recipient. The recipient can view the relevant shared information without creating a Zplit account; selected receipts may be included where the owner has chosen them. The link is temporary and bearer-based, so the README does not make broader privacy or security promises than the implementation supports.

## Why this is more than CRUD

Zplit’s interesting parts are the boundaries between records, identity, permissions, and time:

- **Different accounting models.** Personal and Organization ledgers are owner/entity-centric. Groups preserve peer-to-peer obligations between participants. The three contexts are related, but they are not collapsed into one accounting model.
- **Durable identity.** A local Friend or Group participant can later connect to a registered account without rewriting historical shares, repayments, allocations, or balances. Financial identity is based on stable IDs—not display names or email matching.
- **Explainable financial lifecycles.** Original obligations remain historical facts. Payment settlements and offset settlements are distinct events, and settlement applications explain which obligations a confirmed event covered. Applications are not a second balance engine.
- **Transactional correctness under races.** PostgreSQL constraints and transactions protect invariants; lifecycle workflows use deterministic locking where competing confirmations, settlements, offsets, or participant changes could otherwise disagree. Relevant workflows have real PostgreSQL race tests.
- **Centralized authorization.** Organization access is resolved from capabilities and permission families rather than scattered role-name checks.
- **Realtime as freshness.** PostgreSQL remains canonical. `LISTEN/NOTIFY` publishes wake-ups to an authenticated SSE stream, and one shared realtime/reconciliation path serves Chat, Inbox, and feature-specific freshness updates. Clients refetch persisted state when needed; realtime delivery is not financial truth.

See [Collaboration architecture](docs/collaboration-architecture.md) for the product and domain contracts behind these decisions.

## Architecture

Zplit is a modular monolith: one Next.js application owns routes, server actions, authentication boundaries, domain rules, repository access, and PostgreSQL access.

```text
Web / Next.js
      ↓
server + domain boundaries
      ├── Personal + Organization scoped-ledger domain ──┐
      └── Group peer-to-peer accounting domain ──────────┤
                                                         ↓
                                                    PostgreSQL
                                                         ↓
                                                LISTEN/NOTIFY wake-ups
                                                         ↓
                                             authenticated SSE transport
                                                         ↓
                                      Chat / Inbox / freshness reconciliation
```

The public share route has its own bearer-token resolution path, while authenticated pages and actions use owner- or scope-aware repository boundaries. See [Architecture](docs/architecture.md) for the request flow, ledger modules, integrity rules, and transaction-sensitive workflows.

## Correctness and quality

Validation goes beyond UI tests. The repository combines:

- TypeScript, ESLint, `npm run check:boundaries`, and `npm run check:readability`;
- Vitest and React Testing Library for domain, server, component, route, accessibility, and UI contracts;
- real PostgreSQL migration, constraint, ownership, settlement, receipt, share-link, and race smoke tests;
- deployment and release contract checks, including a production build in CI;
- backup verification, migration-integrity checks, and guarded disposable scale/showcase tooling.

The detailed test matrix and database-safety boundaries live in [Testing](docs/testing.md). Do not run database or scale commands against production.

## Technology stack

| Area | Current tools |
| --- | --- |
| Application | Next.js 16.2 App Router and server actions, React 19.2, TypeScript 6.0 |
| Data and auth | PostgreSQL 18.4, Drizzle ORM 0.45, Better Auth 1.6 |
| Quality | Vitest 4.1, React Testing Library 16.3, ESLint 9.39 |
| Runtime and presentation | Docker Compose, Caddy, ordered custom CSS fragments |

## Running locally

Prerequisites: Node.js 24.18 or newer, npm 11, and PostgreSQL. Configure the required `DB_*` and `BETTER_AUTH_*` environment values first; database and authentication secrets are read from files in the supported setup.

```sh
npm ci
npm run db:migrate
npm run dev
```

The application is invitation-only. For a local installation, bootstrap an owner with `scripts/bootstrap-owner.ts` after configuring its secret-file environment. See [Operations](docs/operations.md) for migration and environment conventions.

Useful checks include:

```sh
npm run typecheck
npm run lint
npm run check:boundaries
npm run check:readability
npm test
```

## Further documentation

- [Architecture](docs/architecture.md) — application boundaries, ledger modules, data flow, and integrity rules.
- [Collaboration architecture](docs/collaboration-architecture.md) — Personal, Group, Organization, identity, accounting, permission, Chat, and realtime contracts.
- [Testing](docs/testing.md) — focused tests, PostgreSQL workflows, deployment checks, and disposable scale validation.
- [Design system](docs/design-system.md) — product language, visual rules, responsive hierarchy, and public-motion boundaries.
- [Operations](docs/operations.md) — self-hosting, migrations, deployment, backups, restoration, and fixture safety.
- [Changelog](CHANGELOG.md) — curated product, system, security, and operational history.

## Docker and self-hosting

Compose provides the web service, PostgreSQL, migration runner, and local owner bootstrap tool. The web container is non-root and the database stays on its private network; Caddy remains the deployment ingress. The operational details intentionally live in [Operations](docs/operations.md).

For a basic Compose deployment:

```sh
docker compose -f compose.yml up -d postgres
docker compose -f compose.yml build migrate
docker compose -f compose.yml --profile tools run --rm migrate
docker compose -f compose.yml build web
docker compose -f compose.yml up -d web
```

Production backups, rollback boundaries, Caddy routing, security headers, and disposable database workflows are documented there rather than treated as the product’s headline.

## Privacy boundaries

Private application routes require Better Auth sessions and owner-/scope-aware reads. Receipts and repayment payment proofs are stored as private evidence; payment proofs do not enter public statements or share links. A share link is a seven-day bearer link whose random token is returned once while only its SHA-256 hash is stored. The owner controls which eligible receipts are mapped to that link.

These are implementation boundaries, not a substitute for handling production credentials and data carefully. Keep secrets, backups, invitations, bearer links, and real financial records out of source control.
