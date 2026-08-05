# Zplit release runbook

Run from /home/ubuntu/zplit. Zplit is an independent application deployment;
the neutral edge at /home/ubuntu/edge owns public Caddy, ports 80/443,
certificates, route installation, validation, reload, and edge rollback.
Zplit must never inspect, restart, or manipulate a DeskTorrent Caddy container.

## Release gate

Use explicit commits; do not infer them from a worktree:

    set -euo pipefail
    cd /home/ubuntu/zplit
    : "${{ZPLIT_RELEASE_COMMIT:?}"
    : "${{ZPLIT_PREVIOUS_COMMIT:?}"
    test "$(git rev-parse HEAD)" = "$ZPLIT_RELEASE_COMMIT"
    test "$(git branch --show-current)" = main
    test -z "$(git status --porcelain=v1 --untracked-files=all)"
    git cat-file -e "${{ZPLIT_RELEASE_COMMIT}^{commit}"
    git cat-file -e "${{ZPLIT_PREVIOUS_COMMIT}^{commit}"
    git fsck --full --connectivity-only

The corrected scripts/verify-backup.sh and scripts/backup-integrity.ts remain
authoritative. The verified fresh backup is unchanged and remains:

/home/ubuntu/.local/state/zplit/backups/d05107d/zplit-20260805T222932Z.dump

Its manifest is the adjacent .json file. Do not create another backup,
restore the database, or change production data. Read the live
drizzle.__drizzle_migrations journal and compare it with the explicit release
histories using scripts/backup-integrity.ts --check-journal-stdin. Migration
0009 is already applied; do not run it again.

Run the deployment contract tests and git diff --check once. Do not run
application builds, release smoke, browser automation, Chromium, Playwright,
npm audit, or full application suites for this edge-only change.

## Route publication

The route source is pinned to the exact Zplit release commit:

    /home/ubuntu/edge/scripts/install-routes.sh \
      "$INFRA_COMMIT" "$ZPLIT_RELEASE_COMMIT" "$EPRESENSI_SOURCE_HEAD"

The installer reads deploy/Caddyfile with git show, installs its commit-pinned
copy as /var/lib/wildan-edge/routes/zplit.caddy, validates the complete
assembled Caddy configuration, and updates
/var/lib/wildan-edge/routes-manifest.json atomically. Verify the neutral
manifest and hashes with:

    /home/ubuntu/edge/scripts/check-deployment.sh

Ordinary route publication reloads the neutral Caddy process in place. It does
not restart Caddy or any application and does not inspect a DeskTorrent
container.

## Application deployment and rollback

Keep PostgreSQL healthy. Ordinary application rollback changes only the Zplit
application image and route; it does not roll back the database and never
reruns migration 0009. The current production image remains the healthy
rollback version for this edge-only task.

The next Zplit application deployment must correct the known release-smoke
failure: /login lacks the required X-Robots-Tag. That defect is deliberately
left unchanged here.
