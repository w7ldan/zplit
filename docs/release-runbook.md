# Zplit release runbook

Run this from `/home/ubuntu/zplit` as the deployment operator. Keep PostgreSQL and every DeskTorrent service running throughout this code-only release. Do not deploy if the production proxy topology is not Cloudflare → the shared Caddy container → `zplit-web`.

## Release identity and local checks

Set the exact reviewed commit and the exact commit recorded for the currently deployed release. Never infer the previous commit from `HEAD`:

```sh
set -euo pipefail
cd /home/ubuntu/zplit

: "${ZPLIT_RELEASE_COMMIT:?set the exact reviewed release commit}"
: "${ZPLIT_PREVIOUS_COMMIT:?set the exact currently deployed commit from the prior deployment record}"
release_commit="$ZPLIT_RELEASE_COMMIT"
previous_commit="$ZPLIT_PREVIOUS_COMMIT"
database_schema_commit=
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]]
[[ "$previous_commit" =~ ^[0-9a-f]{40}$ ]]
git cat-file -e "${release_commit}^{commit}"
git cat-file -e "${previous_commit}^{commit}"
test "$(git branch --show-current)" = main
test "$(git rev-parse HEAD)" = "$release_commit"
test "$release_commit" != "$previous_commit"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
git fsck --full --connectivity-only
test "$(stat -c '%a' scripts/create-backup.sh)" = 755
test "$(stat -c '%a' scripts/verify-backup.sh)" = 755
```

Run this resource gate once. The bracketed patterns prevent the check from matching its own command:

```sh
available_mib=$(free -m | awk '/^Mem:/ { print $7 }')
free_gib=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
test "$available_mib" -ge 700
test "$free_gib" -ge 4
test -z "$(pgrep -af '[z]plit|[v]itest|[n]ext build|[d]ocker compose.*build' || true)"
test -z "$(journalctl -k --since '30 min ago' --no-pager 2>/dev/null | grep -Eiq 'out of memory|oom-kill|killed process' && echo oom || true)"
```

Run the local validation sequence once, in this order. The release includes migration `0009_cascade_confirmed_ledger_deletions`:

```sh
npm run test:deployment
npm run typecheck
npx vitest run src/auth/factory.test.ts src/auth/runtime.test.ts
npx vitest run --maxWorkers=1
npm run lint
npm run build
git diff --check
```

Do not run database smokes, Chromium, Playwright, browser automation, repeated full suites or builds, or `npm audit` again.

## Cloudflare topology gate

Before changing anything, verify that the production hostname is actually proxied by Cloudflare. Stop and report the observed DNS/HTTP topology if this check fails:

```sh
production_headers=$(curl -fsS --max-time 10 -D - -o /dev/null https://idr.wildan.lol/healthz)
printf '%s\n' "$production_headers" | grep -Eiq '^server:[[:space:]]*cloudflare[[:space:]]*$'
printf '%s\n' "$production_headers" | grep -Eiq '^cf-ray:'
getent ahosts idr.wildan.lol | awk '{print $1}' | sort -u
```

## Database schema identity

Do not infer the database schema commit from `HEAD`. Read the live production
rows from `drizzle.__drizzle_migrations` as `id`, `hash`, and `created_at`,
ordered by `id`, and compare that complete sequence with both explicit commit
histories. `scripts/backup-integrity.ts --check-journal-stdin` uses the
installed Drizzle `0.45.2` file reader and hash algorithm; it does not use the
current worktree migration journal:

```sh
live_journal=$(docker compose -f compose.yml exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/postgres_password)" psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --quiet --set=ON_ERROR_STOP=1 --field-separator="$(printf "\\t")" -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id"')
matches_previous=no
matches_release=no
if printf '%s\n' "$live_journal" | ZPLIT_BACKUP_GIT_COMMIT="$previous_commit" ./node_modules/.bin/tsx scripts/backup-integrity.ts --check-journal-stdin; then
  matches_previous=yes
fi
if printf '%s\n' "$live_journal" | ZPLIT_BACKUP_GIT_COMMIT="$release_commit" ./node_modules/.bin/tsx scripts/backup-integrity.ts --check-journal-stdin; then
  matches_release=yes
fi
if [[ "$matches_previous" = yes ]]; then
  database_schema_commit="$previous_commit"
elif [[ "$matches_release" = yes ]]; then
  database_schema_commit="$release_commit"
else
  echo "live migration history matches neither release commit" >&2
  exit 1
fi
```

Record `database_schema_commit` separately from `previous_commit` and
`release_commit`. If the live journal matches the release history,
migration `0009` is already applied; retain the idempotent migrator run as a
verification and do not describe it as newly applied. If it matches only the
previous history, migration `0009` is pending and the migrator applies it.

## Capture and persistent Caddy source

Capture the current Zplit image before building. Record its image ID and configured image name, then verify the rollback tag resolves to that exact ID:

```sh
zplit_container=$(docker compose -f compose.yml ps -q web)
[[ "$zplit_container" =~ ^[0-9a-f]{12,64}$ ]]
previous_image_id=$(docker inspect --format '{{.Image}}' "$zplit_container")
previous_image_name=$(docker inspect --format '{{.Config.Image}}' "$zplit_container")
[[ "$previous_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
test -n "$previous_image_name"
rollback_image_tag="zplit-web:rollback-$previous_commit"
docker tag "$previous_image_id" "$rollback_image_tag"
test "$(docker image inspect --format '{{.Id}}' "$rollback_image_tag")" = "$previous_image_id"
```

The shared Caddy container owns the master `/etc/caddy/Caddyfile`; Zplit owns only the directly mounted route `/etc/caddy/routes/zplit.caddy`. Resolve exactly one read-only bind mount to the repository route. Do not search for a master-file or directory mount, reject the repository source, restart Caddy, or repair a stale mount:

```sh
caddy_container=$(docker ps --filter name='^/desktorrent-watch-web-1$' --filter status=running --format '{{.ID}}')
[[ "$caddy_container" =~ ^[0-9a-f]{12,64}$ ]]
caddy_container_start=$(docker inspect --format '{{.State.StartedAt}}' "$caddy_container")
route_destination=/etc/caddy/routes/zplit.caddy
expected_route_source=$(realpath -- /home/ubuntu/zplit/deploy/Caddyfile)
mounts=$(docker inspect --format '{{json .Mounts}}' "$caddy_container")
mapfile -t route_mounts < <(node --input-type=module - "$mounts" <<'NODE'
const mounts = JSON.parse(process.argv[2]);
for (const mount of mounts) {
  if (mount.Type === "bind" && mount.Destination === "/etc/caddy/routes/zplit.caddy") {
    console.log([mount.Source, mount.RW, mount.Mode].join("\t"));
  }
}
NODE
)
test "${#route_mounts[@]}" -eq 1
IFS=$'\t' read -r route_source route_rw route_mode <<<"${route_mounts[0]}"
test "$route_rw" = false
case ",$route_mode," in *,ro,*) ;; *) echo "Zplit Caddy route must be read-only" >&2; exit 1 ;; esac
test "$(realpath -- "$route_source")" = "$expected_route_source"
authoritative_caddy_source="$route_source"
route_source_path="$authoritative_caddy_source"
route_destination_path="$route_destination"

mounted_route=$(mktemp)
docker exec "$caddy_container" cat "$route_destination" > "$mounted_route"
cmp -s deploy/Caddyfile "$mounted_route"
rm -f "$mounted_route"

caddy_image=$(docker inspect --format '{{.Config.Image}}' "$caddy_container")
docker run --rm --network none --read-only \
  --mount "type=bind,src=$expected_route_source,dst=$route_destination,readonly" \
  "$caddy_image" caddy validate --config "$route_destination" --adapter caddyfile
docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

release_state_root="${XDG_STATE_HOME:-$HOME/.local/state}/zplit/releases"
release_state_dir="$release_state_root/$release_commit"
test ! -e "$release_state_dir"
install -d -m 700 "$release_state_dir"
previous_caddy_rollback_copy="$release_state_dir/previous-Caddyfile"
git show "${previous_commit}:deploy/Caddyfile" > "$previous_caddy_rollback_copy"
chmod 600 "$previous_caddy_rollback_copy"
test "$(stat -c '%a' "$previous_caddy_rollback_copy")" = 600
```

The byte-for-byte comparison above is the mounted-route guard. Do not overwrite a Caddy container whose route is image-baked, volume-backed at another path, or stale. The shared master Caddy configuration remains owned by the infrastructure deployment.

## Backup and release state

Reuse a backup only when `ZPLIT_PREVIOUS_STATE_FILE` resolves to the canonical state file for `previous_commit`, records that exact previous release, records successful restoration verification, and points to regular non-symlink dump and manifest files whose manifest commit is `previous_commit`. A supplied but invalid state file is an error; it is never silently treated as reusable.

```sh
backup_restoration_verified=no
dump_path=
manifest_path=
if [[ -n "${ZPLIT_PREVIOUS_STATE_FILE:-}" ]]; then
  expected_previous_state_file=$(realpath -m -- "$release_state_root/$previous_commit/release-state.env")
  supplied_previous_state_file=$(realpath -- "$ZPLIT_PREVIOUS_STATE_FILE")
  test "$supplied_previous_state_file" = "$expected_previous_state_file"
  test -f "$supplied_previous_state_file"
  previous_state_mode=$(stat -c '%a' "$supplied_previous_state_file")
  test "$previous_state_mode" = 600
  # This file is generated below and contains paths/IDs only, never secrets.
  current_release_commit="$release_commit"
  current_previous_commit="$previous_commit"
  current_database_schema_commit="$database_schema_commit"
  current_previous_image_id="$previous_image_id"
  current_previous_image_name="$previous_image_name"
  current_rollback_image_tag="$rollback_image_tag"
  current_authoritative_caddy_source="$authoritative_caddy_source"
  current_route_destination="$route_destination"
  current_route_source_path="$route_source_path"
  current_route_destination_path="$route_destination_path"
  current_previous_caddy_rollback_copy="$previous_caddy_rollback_copy"
  current_caddy_container="$caddy_container"
  current_caddy_container_start="$caddy_container_start"
  . "$supplied_previous_state_file"
  recorded_release_commit="$release_commit"
  recorded_database_schema_commit="${database_schema_commit:-}"
  recorded_backup_restoration_verified="${backup_restoration_verified:-no}"
  recorded_backup_dump_path="${backup_dump_path:-}"
  recorded_backup_manifest_path="${backup_manifest_path:-}"
  release_commit="$current_release_commit"
  previous_commit="$current_previous_commit"
  database_schema_commit="$current_database_schema_commit"
  previous_image_id="$current_previous_image_id"
  previous_image_name="$current_previous_image_name"
  rollback_image_tag="$current_rollback_image_tag"
  authoritative_caddy_source="$current_authoritative_caddy_source"
  route_destination="$current_route_destination"
  route_source_path="$current_route_source_path"
  route_destination_path="$current_route_destination_path"
  previous_caddy_rollback_copy="$current_previous_caddy_rollback_copy"
  caddy_container="$current_caddy_container"
  caddy_container_start="$current_caddy_container_start"
  test "$recorded_release_commit" = "$previous_commit"
  test "$recorded_database_schema_commit" = "$database_schema_commit"
  test "$recorded_backup_restoration_verified" = yes
  test -f "$recorded_backup_dump_path" && test ! -L "$recorded_backup_dump_path"
  test -f "$recorded_backup_manifest_path" && test ! -L "$recorded_backup_manifest_path"
node --input-type=module - "$recorded_backup_manifest_path" "$database_schema_commit" <<'NODE'
const [manifestPath, expectedCommit] = process.argv.slice(2);
const manifest = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(manifestPath, "utf8")));
if (manifest.gitCommit !== expectedCommit) process.exit(1);
NODE
  dump_path="$recorded_backup_dump_path"
  manifest_path="$recorded_backup_manifest_path"
fi
if [[ -z "$dump_path" ]]; then
  backup_dir="${ZPLIT_BACKUP_DIRECTORY:?set an absolute secure backup directory}"
  ZPLIT_BACKUP_GIT_COMMIT="$database_schema_commit" ./scripts/create-backup.sh "$backup_dir"
  dump_path=$(find "$backup_dir" -maxdepth 1 -type f -name 'zplit-*.dump' -print -quit)
  test -n "$dump_path"
  manifest_path="${dump_path%.dump}.json"
  test -f "$manifest_path"
  ./scripts/verify-backup.sh "$dump_path"
  backup_restoration_verified=yes
fi
```

Persist the complete rollback state before any live Caddy reload. The state file is mode `600`, the directory is mode `700`, and the file contains IDs and paths only, never secrets or backup contents. Call this function again after the new and deployed image IDs are known:

```sh
newly_built_image_id=
deployed_image_id=
state_file="$release_state_dir/release-state.env"
write_release_state() {
  state_tmp="$release_state_dir/.release-state.env.tmp"
  printf '%s\n' \
    "release_commit=$(printf '%q' "$release_commit")" \
    "previous_commit=$(printf '%q' "$previous_commit")" \
    "database_schema_commit=$(printf '%q' "$database_schema_commit")" \
    "previous_image_id=$(printf '%q' "$previous_image_id")" \
    "previous_image_name=$(printf '%q' "$previous_image_name")" \
    "newly_built_image_id=$(printf '%q' "$newly_built_image_id")" \
    "deployed_image_id=$(printf '%q' "$deployed_image_id")" \
    "rollback_image_tag=$(printf '%q' "$rollback_image_tag")" \
    "authoritative_caddy_source=$(printf '%q' "$authoritative_caddy_source")" \
    "route_destination=$(printf '%q' "$route_destination")" \
    "route_source_path=$(printf '%q' "$route_source_path")" \
    "route_destination_path=$(printf '%q' "$route_destination_path")" \
    "previous_caddy_rollback_copy=$(printf '%q' "$previous_caddy_rollback_copy")" \
    "backup_dump_path=$(printf '%q' "$dump_path")" \
    "backup_manifest_path=$(printf '%q' "$manifest_path")" \
    "backup_restoration_verified=$(printf '%q' "$backup_restoration_verified")" \
    "caddy_container=$(printf '%q' "$caddy_container")" \
    "caddy_container_start=$(printf '%q' "$caddy_container_start")" > "$state_tmp"
  chmod 600 "$state_tmp"
  mv -f "$state_tmp" "$state_file"
  test "$(stat -c '%a' "$state_file")" = 600
}
write_release_state
```

## Production deployment

Build the reviewed web image once and run the existing migrator once. Migration `0009_cascade_confirmed_ledger_deletions` changes only the two foreign-key delete actions and performs no data rewrite. Backup verification is mandatory before migration; ordinary application rollback does not restore the database. Before running it, record whether `database_schema_commit` matches `release_commit`: that means `0009` was already applied and the migrator is an idempotent verification; otherwise `0009` is pending.

```sh
docker compose -f compose.yml build web
newly_built_image_id=$(docker image inspect --format '{{.Id}}' zplit-web:local)
[[ "$newly_built_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
write_release_state
docker compose -f compose.yml --profile tools run --rm migrate
```

Confirm the direct route bind still matches the committed route, validate the route and complete master configuration, then reload only the shared Caddy process. Never replace `/etc/caddy/Caddyfile`, recreate Caddy, or restart a DeskTorrent service:

```sh
mounted_route=$(mktemp)
docker exec "$caddy_container" cat "$route_destination" > "$mounted_route"
cmp -s deploy/Caddyfile "$mounted_route"
rm -f "$mounted_route"
docker run --rm --network none --read-only \
  --mount "type=bind,src=$expected_route_source,dst=$route_destination,readonly" \
  "$caddy_image" caddy validate --config "$route_destination" --adapter caddyfile
docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

After reload, prove the route bytes and Caddy identity are unchanged:

```sh
mounted_route=$(mktemp)
docker exec "$caddy_container" cat "$route_destination" > "$mounted_route"
cmp -s deploy/Caddyfile "$mounted_route"
rm -f "$mounted_route"
test "$(docker ps --filter name='^/desktorrent-watch-web-1$' --filter status=running --format '{{.ID}}')" = "$caddy_container"
test "$(docker inspect --format '{{.State.StartedAt}}' "$caddy_container")" = "$caddy_container_start"
```

Recreate only Zplit web, verify the deployed image ID, wait for health, run the existing release smoke once, and inspect bounded recent logs. Do not start or restart DeskTorrent:

```sh
docker compose -f compose.yml up -d --no-deps --force-recreate web
deployed_image_id=$(docker inspect --format '{{.Image}}' "$(docker compose -f compose.yml ps -q web)")
test "$deployed_image_id" = "$newly_built_image_id"
write_release_state
for attempt in $(seq 1 30); do
  container_id=$(docker compose -f compose.yml ps -q web)
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)
  [[ "$status" = healthy ]] && break
  [[ "$attempt" -lt 30 ]] || exit 1
  sleep 2
done
docker compose -f compose.yml exec -T web node -e 'fetch("http://127.0.0.1:3000/healthz").then(async response => { const body = await response.json(); if (!response.ok || body.status !== "ok") process.exit(1); }).catch(() => process.exit(1))'
npm run test:release
docker compose -f compose.yml logs --since 10m --tail 100 web
docker logs --since 10m --tail 100 "$caddy_container"
```

If any post-deployment check fails, roll back immediately. Do not restore the database for this code-only release.

## Application and Caddy rollback

Load the recorded state; do not depend on variables from the deployment command block and do not reconstruct the previous Caddyfile from a commit:

```sh
set -euo pipefail
cd /home/ubuntu/zplit
: "${ZPLIT_RELEASE_STATE_FILE:?set the recorded release-state.env path}"
test -f "$ZPLIT_RELEASE_STATE_FILE"
test "$(stat -c '%a' "$ZPLIT_RELEASE_STATE_FILE")" = 600
. "$ZPLIT_RELEASE_STATE_FILE"
: "${previous_image_id:?}"
: "${rollback_image_tag:?}"
: "${authoritative_caddy_source:?}"
: "${route_destination:?}"
: "${previous_caddy_rollback_copy:?}"
: "${caddy_container:?}"
: "${caddy_container_start:?}"

test "$(realpath -- "$authoritative_caddy_source")" = "$(realpath -- /home/ubuntu/zplit/deploy/Caddyfile)"
route_mode=$(stat -c '%a' /home/ubuntu/zplit/deploy/Caddyfile)
install -m "$route_mode" "$previous_caddy_rollback_copy" /home/ubuntu/zplit/deploy/Caddyfile
cmp -s "$previous_caddy_rollback_copy" "$authoritative_caddy_source"
test "$(docker ps --filter name='^/desktorrent-watch-web-1$' --filter status=running --format '{{.ID}}')" = "$caddy_container"
docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
rollback_zplit_route=$(mktemp)
docker exec "$caddy_container" cat "$route_destination" > "$rollback_zplit_route"
cmp -s "$previous_caddy_rollback_copy" "$rollback_zplit_route"
rm -f "$rollback_zplit_route"
test "$(docker inspect --format '{{.State.StartedAt}}' "$caddy_container")" = "$caddy_container_start"
test "$(docker image inspect --format '{{.Id}}' "$rollback_image_tag")" = "$previous_image_id"
docker tag "$rollback_image_tag" zplit-web:local
test "$(docker image inspect --format '{{.Id}}' zplit-web:local)" = "$previous_image_id"
docker compose -f compose.yml up -d --no-deps --force-recreate web
for attempt in $(seq 1 30); do
  container_id=$(docker compose -f compose.yml ps -q web)
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)
  [[ "$status" = healthy ]] && break
  [[ "$attempt" -lt 30 ]] || exit 1
  sleep 2
done
docker compose -f compose.yml exec -T web node -e 'fetch("http://127.0.0.1:3000/healthz").then(async response => { const body = await response.json(); if (!response.ok || body.status !== "ok") process.exit(1); }).catch(() => process.exit(1))'
```

The in-place route restoration intentionally dirties the Git worktree because the file is a direct bind source. Do not clean or reset it until route validation, Caddy reload, web health, and `/healthz` verification have completed. Never recreate PostgreSQL, restore the database, or start/restart DeskTorrent during application/Caddy rollback.
