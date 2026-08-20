# Operations

These procedures describe the current standalone Zplit deployment. Keep production data, credentials, and backup files access-controlled; never paste secret contents, bearer tokens, or passwords into commands or documentation.

## Production shape

The neutral Caddy edge owns ports 80/443, TLS, the assembled route, and the public security headers. It routes the Zplit site to the `zplit-web` alias on the external `wildan-edge-zplit` network. Zplit’s `web` container listens on port 3000 internally and connects to PostgreSQL through the private `database` network. PostgreSQL has the persistent Compose volume; `migrate` and `bootstrap-owner` are profile-gated tools.

The `web` service intentionally pins the ingress address to `172.25.0.19`. Caddy and the deployment contract use the stable service alias/address as the upstream boundary. Do not change this IP casually: update the edge network and its contract together, with an explicit deployment review.

The web container is non-root, read-only, drops capabilities, uses `no-new-privileges`, and has bounded temporary filesystems. The edge marks private paths non-indexable and no-store and applies HSTS, CSP, frame, content-type, permissions, opener, and referrer policies. Cloudflare client-IP forwarding is accepted only through the configured trusted peer ranges.

## Migrations

Start a healthy PostgreSQL service, then run the migrator image:

```sh
docker compose -f compose.yml up -d postgres
docker compose -f compose.yml build migrate
docker compose -f compose.yml --profile tools run --rm migrate
```

The migration runner uses the database secret file, takes an advisory lock, and applies the checked-in `drizzle` journal. Never skip a failed migration or manually rerun a journal entry. Verify the database health and migration state before starting a new web image.

## Deploy, verify, and roll back

1. Confirm the intended release commit, branch, and clean release worktree. Do not infer the release commit from uncommitted files.
2. Keep PostgreSQL healthy and apply migrations before serving code that requires them.
3. Build the web image and start or replace only the Zplit web service.
4. Publish the commit-pinned route through the neutral edge’s route installer; validate the assembled Caddy configuration and route manifest.
5. Check Compose health and run the release/deployment contract checks. The release smoke checks `/healthz`, the public root, private-route headers/redirect behavior, robots, sitemap, manifest, service worker, and security headers.
6. For rollback, restore the previous application image and route commit. Do not roll the database backward or rerun an already-applied migration; retain the database until the rollback is verified.

Useful local checks are:

```sh
npm run test:deployment
npm run test:release
docker compose -f compose.yml ps
docker compose -f compose.yml logs --tail=100 web
```

## Backups and restoration

Create a backup only from a running, healthy Compose PostgreSQL service and pass the exact release/schema commit explicitly:

```sh
ZPLIT_BACKUP_GIT_COMMIT=$(git rev-parse HEAD) \
  ./scripts/create-backup.sh /absolute/backup/directory
./scripts/verify-backup.sh /absolute/backup/directory/zplit-YYYYMMDDTHHMMSSZ.dump
```

Creation checks the live migration journal, writes a PostgreSQL custom-format archive and adjacent manifest, hashes and sizes the archive, and uses restrictive permissions. The archive contains credentials, ledger data, invitations, link hashes, and private receipt bytes. Store it as sensitive data. Verification checks the manifest, hash, byte length, commit, restore, migration/data integrity, and removes its disposable PostgreSQL environment on exit. A backup is not trusted until verification succeeds.

Production restoration is manual and never replaces the live database automatically:

1. Verify the archive and its adjacent manifest.
2. Stop the Zplit web service.
3. Prepare a new empty PostgreSQL database or volume.
4. Restore with `pg_restore --exit-on-error --no-owner --no-privileges`.
5. Run the current migrations and backup-integrity checks.
6. Point Zplit at the restored database, start the web service, and check `/healthz` plus the release checks.
7. Retain the old database until the restored deployment is verified.

## Disposable scale environment

Scale fixtures must use the database name `zplit_scale_test`, a dedicated owner, and `ZPLIT_SCALE_TEST_CONFIRM=scale-test-only`. The seed and clear commands are the only fixture mutations; verification and scale smokes are read-only. Never use production, the showcase database, or a shared database. See [Testing](testing.md) for budgets, resource gates, and workload guidance.

## Showcase fixture

The capture fixture is disposable and must use a separate database named `zplit_showcase`, a dedicated owner, and `ZPLIT_SHOWCASE_CONFIRM=showcase-only`. Configure credentials through regular secret files, run the app on its separate local port, and use only the `showcase:setup`, `showcase:state`, `showcase:verify`, and `showcase:clear` commands for the fixture workflow. Read-only verification does not require mutation confirmation; setup, state changes, and clearing do.

The state commands replace only the showcase owner’s ledger, receipts, and share-link records in a guarded transaction. They retain the dummy login. After capture, clear only that owner’s disposable records and drop the isolated database separately if no longer needed. If the database name or confirmation value is wrong, stop: do not remove guards or substitute another database.
