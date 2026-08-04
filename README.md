# Zplit

Zplit is a self-hostable personal expense and repayment tracker.

## Current checkpoint

Authentication supports multiple users structurally, every domain record is scoped to its owner, and the protected application provides owner-scoped Friends, Outings, outing-bound Expenses, manual whole-rupiah friend-share assignment, repayment records, repayment allocation, ledger overview, owner-issued one-time account invitations, and temporary read-only debtor balance links. Outings own occurrence date and time; changing an expense’s outing changes its effective date, and independent expenses are not supported. Public registration remains disabled; invitations create normal Better Auth credential accounts with empty ledgers. Notifications and exports are later stages. The design contract is in `docs/design-system.md`.

## Prerequisites

- Node.js 24.18 or newer
- npm 11

## Commands

```sh
npm ci
npm run dev
npm run typecheck
npm run test:debtor-shares
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

The initial schema and authenticated Friends, Outings, outing-bound Expenses, owner-scoped manual share workflows, repayment recording, repayment allocation, ledger overview, invitation-only account registration, and temporary debtor balance links are implemented. Only allocated repayment money reduces outstanding balances.
