# Zplit

Zplit is a self-hostable personal expense and repayment tracker.

## Current checkpoint

Authentication supports multiple users structurally, every domain record is scoped to its owner, and the protected application provides owner-scoped Friends, Outings, outing-bound Expenses, private PostgreSQL-backed receipt images, manual whole-rupiah friend-share assignment, repayment records, repayment allocation, ledger overview, owner-issued one-time account invitations, temporary read-only debtor balance links, and ledger exports. Outings own occurrence date and time; changing an expense’s outing changes its effective date, and independent expenses are not supported. Public registration remains disabled; invitations create normal Better Auth credential accounts with empty ledgers. The design contract is in `docs/design-system.md`.

## Prerequisites

- Node.js 24.18 or newer
- npm 11

## Commands

```sh
npm ci
npm run dev
npm run typecheck
npm run test:debtor-shares
npm run test:receipts
npm test
npm run lint
npm run build
npm run test:release
```

CI runs typechecking, the full one-worker Vitest suite, lint, build, and the deployment contract test with `npm ci` on Node 24.18.0.

Authentication keeps production sign-up invitation-only, permits bootstrap-only sign-up, and applies in-memory rate limits of 100 requests per 60 seconds by default and 5 email sign-in attempts per 60 seconds. In-memory storage matches the current single-web-container deployment; replace it with shared storage before horizontal scaling.

The edge removes the `Server` header, enforces HSTS, CSP, permissions, opener, frame, content-type, and referrer policies, and marks private paths non-indexable and non-cacheable. Crawlers may index only the public root. See the [release runbook](docs/release-runbook.md) for backup, deployment, verification, and rollback.

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

The password is read from the ignored `secrets/postgres-password` file. Back it up securely.

## PostgreSQL backups

Create a metadata-only companion manifest and a secure PostgreSQL custom-format archive from the healthy Compose database:

```sh
./scripts/create-backup.sh /absolute/backup/directory
./scripts/verify-backup.sh /absolute/backup/directory/zplit-YYYYMMDDTHHMMSSZ.dump
```

The archive includes users and credentials, ledger data, invitations, debtor share links, and private receipt bytes. Store backup files securely; they contain credentials, ledger data, invitation data, share-link hashes, and private receipt images. The manifest contains only the format version, UTC creation time, Git commit, PostgreSQL version, archive hash and size, and archive filename. A backup is not trusted until disposable restoration verification passes.

### Production restoration runbook

Production restoration is deliberately manual and must never replace the live database automatically:

1. Verify the archive with `./scripts/verify-backup.sh`.
2. Stop the Zplit web service.
3. Prepare a new empty PostgreSQL database or volume.
4. Restore the archive into that empty target with `pg_restore --exit-on-error --no-owner --no-privileges`.
5. Run the current migrations.
6. Run the backup-integrity checks.
7. Point Zplit at the restored database.
8. Start the web service and check `/healthz`.
9. Retain the old database until the restored deployment is verified.

Backup encryption and automatic scheduling are not implemented. Keep the archive and its manifest access-controlled and protected by the storage system used for backups.

The initial schema and authenticated Friends, Outings, outing-bound Expenses, owner-scoped manual share workflows, repayment recording, repayment allocation, ledger overview, invitation-only account registration, and temporary debtor balance links are implemented. Only allocated repayment money reduces outstanding balances.
