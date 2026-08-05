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

Run the local validation sequence once, in this order:

```sh
npx vitest run src/auth/factory.test.ts src/auth/runtime.test.ts
npm run test:deployment
npm run typecheck
npx vitest run --maxWorkers=1
npm run lint
npm run build
git diff --check
```

Do not run database smokes, Chromium, Playwright, browser automation, repeated full suites or builds, or `npm audit` unless the parent validation run did not complete.

## Cloudflare topology gate

Before changing anything, verify that the production hostname is actually proxied by Cloudflare. Stop and report the observed DNS/HTTP topology if this check fails:

```sh
production_headers=$(curl -fsS --max-time 10 -D - -o /dev/null https://idr.wildan.lol/healthz)
printf '%s\n' "$production_headers" | grep -Eiq '^server:[[:space:]]*cloudflare[[:space:]]*$'
printf '%s\n' "$production_headers" | grep -Eiq '^cf-ray:'
getent ahosts idr.wildan.lol | awk '{print $1}' | sort -u
```

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

Identify the running Caddy container and resolve the authoritative mounted Zplit route from Docker mount metadata. The expected destination is `/etc/caddy/routes/zplit.caddy`. Stop if there is no candidate, more than one candidate, a symlink/non-regular source, or an unrelated/shared configuration:

```sh
caddy_container=$(docker ps --filter name='^/desktorrent-watch-web-1$' --filter status=running --format '{{.ID}}')
[[ "$caddy_container" =~ ^[0-9a-f]{12,64}$ ]]
mounts=$(docker inspect --format '{{json .Mounts}}' "$caddy_container")
mapfile -t caddy_sources < <(node --input-type=module - "$mounts" <<'NODE'
const mounts = JSON.parse(process.argv[2]);
for (const mount of mounts) {
  if (mount.Type !== "bind") continue;
  if (mount.Destination === "/etc/caddy/routes/zplit.caddy") console.log(mount.Source);
}
NODE
)
test "${#caddy_sources[@]}" -eq 1
authoritative_caddy_source="${caddy_sources[0]}"
test -f "$authoritative_caddy_source"
test ! -L "$authoritative_caddy_source"
case "$authoritative_caddy_source" in
  /home/ubuntu/zplit/*) echo "Caddy source must be outside the repository" >&2; exit 1 ;;
esac

release_state_root=/var/lib/zplit/release-state
release_state_dir="$release_state_root/$release_commit"
test ! -e "$release_state_dir"
install -d -m 700 "$release_state_dir"
previous_caddy_expected=$(mktemp "$release_state_dir/.previous-caddy.XXXXXX")
git show "${previous_commit}:deploy/Caddyfile" > "$previous_caddy_expected"
cmp -s "$previous_caddy_expected" "$authoritative_caddy_source"
previous_caddy_rollback_copy="$release_state_dir/previous-Caddyfile"
install -m 600 "$authoritative_caddy_source" "$previous_caddy_rollback_copy"
cmp -s "$authoritative_caddy_source" "$previous_caddy_rollback_copy"
rm -f "$previous_caddy_expected"
```

The byte-for-byte comparison above is the mounted-route guard. Do not overwrite a Caddy container whose Zplit route is image-baked, only volume-backed, or mixed with unrelated sites. The shared Caddy configuration remains owned by the infrastructure deployment.

## Backup and release state

Reuse a backup only when the prior release state explicitly records successful restoration verification and both adjacent files are still regular, non-symlink files. Otherwise create and verify one backup. `ZPLIT_PREVIOUS_STATE_FILE` is optional and must point to the immediately preceding release-state file:

```sh
backup_restoration_verified=no
dump_path=
manifest_path=
if [[ -n "${ZPLIT_PREVIOUS_STATE_FILE:-}" && -f "$ZPLIT_PREVIOUS_STATE_FILE" ]]; then
  previous_state_mode=$(stat -c '%a' "$ZPLIT_PREVIOUS_STATE_FILE")
  test "$previous_state_mode" = 600
  # This file is generated below and contains paths/IDs only, never secrets.
  current_release_commit="$release_commit"
  current_previous_commit="$previous_commit"
  current_previous_image_id="$previous_image_id"
  current_previous_image_name="$previous_image_name"
  current_rollback_image_tag="$rollback_image_tag"
  current_authoritative_caddy_source="$authoritative_caddy_source"
  current_previous_caddy_rollback_copy="$previous_caddy_rollback_copy"
  . "$ZPLIT_PREVIOUS_STATE_FILE"
  recorded_backup_restoration_verified="${backup_restoration_verified:-no}"
  recorded_backup_dump_path="${backup_dump_path:-}"
  recorded_backup_manifest_path="${backup_manifest_path:-}"
  release_commit="$current_release_commit"
  previous_commit="$current_previous_commit"
  previous_image_id="$current_previous_image_id"
  previous_image_name="$current_previous_image_name"
  rollback_image_tag="$current_rollback_image_tag"
  authoritative_caddy_source="$current_authoritative_caddy_source"
  previous_caddy_rollback_copy="$current_previous_caddy_rollback_copy"
  if [[ "$recorded_backup_restoration_verified" = yes && -f "$recorded_backup_dump_path" && -f "$recorded_backup_manifest_path" && ! -L "$recorded_backup_dump_path" && ! -L "$recorded_backup_manifest_path" ]]; then
    dump_path="$recorded_backup_dump_path"
    manifest_path="$recorded_backup_manifest_path"
  fi
fi
if [[ -z "$dump_path" ]]; then
  backup_dir="/absolute/secure/backup/directory/zplit-$(date -u +%Y%m%dT%H%M%SZ)"
  ./scripts/create-backup.sh "$backup_dir"
  dump_path=$(find "$backup_dir" -maxdepth 1 -type f -name 'zplit-*.dump' -print -quit)
  test -n "$dump_path"
  manifest_path="${dump_path%.dump}.json"
  test -f "$manifest_path"
  ./scripts/verify-backup.sh "$dump_path"
  backup_restoration_verified=yes
fi
```

Persist the rollback inputs before changing the live Caddy source. The state file is restricted and contains no secrets or backup contents:

```sh
state_file="$release_state_dir/release-state.env"
state_tmp="$release_state_dir/.release-state.env.tmp"
printf '%s\n' \
  "release_commit=$(printf '%q' "$release_commit")" \
  "previous_commit=$(printf '%q' "$previous_commit")" \
  "previous_image_id=$(printf '%q' "$previous_image_id")" \
  "previous_image_name=$(printf '%q' "$previous_image_name")" \
  "rollback_image_tag=$(printf '%q' "$rollback_image_tag")" \
  "authoritative_caddy_source=$(printf '%q' "$authoritative_caddy_source")" \
  "previous_caddy_rollback_copy=$(printf '%q' "$previous_caddy_rollback_copy")" \
  "backup_dump_path=$(printf '%q' "$dump_path")" \
  "backup_manifest_path=$(printf '%q' "$manifest_path")" \
  "backup_restoration_verified=$(printf '%q' "$backup_restoration_verified")" > "$state_tmp"
chmod 600 "$state_tmp"
mv -f "$state_tmp" "$state_file"
printf 'release state: %s\n' "$state_file"
```

## Production deployment

Validate the reviewed repository route before replacing the persistent source, then build the corrected web image once and run the existing migrator once:

```sh
caddy_image=$(docker inspect --format '{{.Config.Image}}' "$caddy_container")
docker run --rm --network none --read-only \
  --mount "type=bind,src=$PWD/deploy/Caddyfile,dst=/etc/caddy/routes/zplit.caddy,readonly" \
  "$caddy_image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f compose.yml build web
docker compose -f compose.yml --profile tools run --rm migrate
```

Install the new route atomically into the authoritative persistent source, validate the assembled Caddy configuration inside the running Caddy container, reload Caddy without restarting its container, and prove the running container sees the same route bytes:

```sh
caddy_source_mode=$(stat -c '%a' "$authoritative_caddy_source")
caddy_new_tmp="$(dirname "$authoritative_caddy_source")/.Caddyfile.$release_commit.tmp"
test ! -e "$caddy_new_tmp"
install -m "$caddy_source_mode" deploy/Caddyfile "$caddy_new_tmp"
cmp -s deploy/Caddyfile "$caddy_new_tmp"
mv -f "$caddy_new_tmp" "$authoritative_caddy_source"
docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
running_zplit_route=$(mktemp "$release_state_dir/.running-zplit-route.XXXXXX")
docker exec "$caddy_container" cat /etc/caddy/routes/zplit.caddy > "$running_zplit_route"
cmp -s deploy/Caddyfile "$running_zplit_route"
rm -f "$running_zplit_route"
```

Recreate only Zplit web, wait for healthy status, run the existing release smoke once, and inspect bounded recent logs. Do not start or restart DeskTorrent:

```sh
docker compose -f compose.yml up -d --no-deps --force-recreate web
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
: "${previous_caddy_rollback_copy:?}"

rollback_mode=$(stat -c '%a' "$authoritative_caddy_source")
rollback_tmp="$(dirname "$authoritative_caddy_source")/.Caddyfile.rollback.tmp"
test ! -e "$rollback_tmp"
install -m "$rollback_mode" "$previous_caddy_rollback_copy" "$rollback_tmp"
cmp -s "$previous_caddy_rollback_copy" "$rollback_tmp"
mv -f "$rollback_tmp" "$authoritative_caddy_source"
caddy_container=$(docker ps --filter name='^/desktorrent-watch-web-1$' --filter status=running --format '{{.ID}}')
[[ "$caddy_container" =~ ^[0-9a-f]{12,64}$ ]]
docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
rollback_caddy_copy=$(mktemp)
docker exec "$caddy_container" cat /etc/caddy/Caddyfile > "$rollback_caddy_copy"
cmp -s "$previous_caddy_rollback_copy" "$rollback_caddy_copy"
rm -f "$rollback_caddy_copy"
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

Never recreate PostgreSQL, restore the database, or start/restart DeskTorrent during application/Caddy rollback. Database restoration is a separate manual procedure for confirmed data loss or an incompatible migration.
