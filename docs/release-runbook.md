# Zplit release runbook

Run this from `/home/ubuntu/zplit` as the deployment operator. Keep the existing PostgreSQL and DeskTorrent services running throughout this code-only release.

## Release sequence

1. Confirm the expected commit and clean worktree:

   ```sh
   test "$(git rev-parse HEAD)" = "281f620a69d0d69fecf7eb8287852098635eae2e"
   test "$(git branch --show-current)" = main
   test -z "$(git status --porcelain)"
   git fsck --full --connectivity-only
   test "$(stat -c '%a' scripts/create-backup.sh)" = 755
   test "$(stat -c '%a' scripts/verify-backup.sh)" = 755
   ```

   After the release commit exists, use that commit in place of the checkpoint value for deployment records.

2. Run the resource gate. Require at least 700 MiB available memory, at least 4 GiB free on `/`, no competing Zplit build/test command, and no recent kernel OOM kill. Stop if any check fails.

   ```sh
   free_mib=$(free -m | awk '/^Mem:/ { print $7 }'); test "$free_mib" -ge 700
   free_gib=$(df --output=avail -BG / | tail -1 | tr -dc '0-9'); test "$free_gib" -ge 4
   ! pgrep -af 'zplit|vitest|next build|docker compose.*build' | grep -v "$$"
   ! journalctl -k --since '30 min ago' --no-pager 2>/dev/null | grep -Eiq 'out of memory|oom-kill|killed process'
   ```

3. Run the bounded validation sequence once:

   ```sh
   npm run typecheck
   npx vitest run src/auth/factory.test.ts src/auth/runtime.test.ts src/app/crawler-metadata.test.ts src/app/healthz/route.test.ts
   npm run test:deployment
   npm test -- --maxWorkers=1
   npm run lint
   npm run build
   npm audit --omit=dev
   git diff --check
   ```

   Do not run database smokes, Chromium, Playwright, browser automation, repeated builds, or repeated full suites.

4. Record the release commit, currently deployed Zplit web image, and current Caddy container:

   ```sh
   git rev-parse HEAD
   docker inspect --format '{{.Image}}' zplit-web-1
   docker inspect --format '{{.Config.Image}}' zplit-web-1
   docker inspect --format '{{.Image}}' desktorrent-watch-web-1
   ```

5. Create one production backup and record the printed dump and manifest paths:

   ```sh
   backup_dir="/absolute/secure/backup/directory/zplit-$(date -u +%Y%m%dT%H%M%SZ)"
   ./scripts/create-backup.sh "$backup_dir"
   dump_path=$(find "$backup_dir" -maxdepth 1 -type f -name 'zplit-*.dump' -print -quit)
   test -n "$dump_path"
   ```

6. Verify that backup through the existing disposable restoration process. Stop immediately if it fails:

   ```sh
   ./scripts/verify-backup.sh "$dump_path"
   ```

   Retain the dump and manifest until release acceptance. Do not commit them.

7. Tag the current web image with the previous commit for rollback:

   ```sh
   previous_commit=$(git rev-parse HEAD)
   previous_image_id=$(docker inspect --format '{{.Image}}' zplit-web-1)
   docker tag "$previous_image_id" "zplit-web:rollback-$previous_commit"
   ```

8. Build the new Zplit web image once:

   ```sh
   docker compose -f compose.yml build web
   ```

9. Run the existing migrator once. This checkpoint has no schema migration, but the normal release contract still runs the existing migration tool:

   ```sh
   docker compose -f compose.yml --profile tools run --rm migrate
   ```

10. Validate the updated Caddy configuration before reload:

    ```sh
    docker exec desktorrent-watch-web-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    ```

11. Reload only the existing shared Caddy service:

    ```sh
    docker exec desktorrent-watch-web-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
    ```

12. Replace only the Zplit web container. Do not recreate PostgreSQL:

    ```sh
    docker compose -f compose.yml up -d --no-deps --force-recreate web
    ```

13. Wait for the Zplit web health check:

    ```sh
    for attempt in $(seq 1 30); do
      container_id=$(docker compose -f compose.yml ps -q web)
      status=$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)
      test "$status" = healthy && break
      test "$attempt" -lt 30 || exit 1
      sleep 2
    done
    ```

14. Run the read-only production smoke once:

    ```sh
    npm run test:release
    ```

15. Inspect only bounded recent Zplit and Caddy logs for deployment errors:

    ```sh
    docker compose -f compose.yml logs --since 10m --tail 100 web
    docker logs --since 10m --tail 100 desktorrent-watch-web-1
    ```

16. If any post-deployment check fails, roll back immediately.

## Rollback

For an application or Caddy failure, restore the previous route file, validate and reload Caddy, restore the tagged web image, and recreate only Zplit web:

```sh
git show "$previous_commit:deploy/Caddyfile" > deploy/Caddyfile
docker exec desktorrent-watch-web-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec desktorrent-watch-web-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
docker tag "zplit-web:rollback-$previous_commit" zplit-web:local
docker compose -f compose.yml up -d --no-deps --force-recreate web
```

Verify `/healthz` and the web Compose health check. Do not restore the database for this code-only checkpoint.

Database restoration is a separate manual operation only for confirmed data loss or an incompatible migration: retain the old database and the verified backup, stop Zplit web, restore into a disposable or new empty PostgreSQL target using the existing restoration procedure, run current migrations and integrity checks, then validate before pointing Zplit at it. Ordinary application/Caddy rollback must never restore the database.

There is no schema migration in this checkpoint. Do not start or restart any DeskTorrent service.
