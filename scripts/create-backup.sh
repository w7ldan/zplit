#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 || $1 != /* ]]; then
  echo "usage: $0 /absolute/backup/directory" >&2
  exit 2
fi

backup_dir=$1
database_schema_commit=${ZPLIT_BACKUP_GIT_COMMIT:-}
if [[ ! $database_schema_commit =~ ^[0-9a-f]{40}$ ]]; then
  echo "ZPLIT_BACKUP_GIT_COMMIT must be a 40-character lowercase commit" >&2
  exit 1
fi
if ! git cat-file -e "${database_schema_commit}^{commit}" 2>/dev/null; then
  echo "ZPLIT_BACKUP_GIT_COMMIT does not exist locally" >&2
  exit 1
fi
if [[ -L "$backup_dir" ]]; then
  echo "backup directory must not be a symlink" >&2
  exit 1
fi
if [[ ! -e "$backup_dir" ]]; then
  mkdir -m 700 -- "$backup_dir"
elif [[ ! -d "$backup_dir" ]]; then
  echo "backup path must be a directory" >&2
  exit 1
fi
dir_mode=$(stat -c '%a' -- "$backup_dir")
if [[ ! $dir_mode =~ ^[0-7]{3}$ || ${dir_mode:1:1} =~ [2367] || ${dir_mode:2:1} =~ [2367] ]]; then
  echo "backup directory must not be group- or world-writable" >&2
  exit 1
fi

compose=(docker compose -f compose.yml)
container_id=$("${compose[@]}" ps -q postgres)
if [[ ! $container_id =~ ^[0-9a-f]{12,64}$ ]]; then
  echo "Compose PostgreSQL service is not running" >&2
  exit 1
fi
state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id")
if [[ $state != "running healthy" ]]; then
  echo "Compose PostgreSQL service is not healthy" >&2
  exit 1
fi

live_journal=$("${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_password)" psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --quiet --set=ON_ERROR_STOP=1 --field-separator="$(printf "\\t")" -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id"')
printf '%s\n' "$live_journal" | ZPLIT_BACKUP_GIT_COMMIT="$database_schema_commit" ./node_modules/.bin/tsx scripts/backup-integrity.ts --check-journal-stdin

timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
created_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
dump_filename="zplit-${timestamp}.dump"
manifest_filename="zplit-${timestamp}.json"
dump_path="$backup_dir/$dump_filename"
manifest_path="$backup_dir/$manifest_filename"
if [[ -e "$dump_path" || -L "$dump_path" || -e "$manifest_path" || -L "$manifest_path" ]]; then
  echo "backup output already exists" >&2
  exit 1
fi

dump_partial=$(mktemp "$backup_dir/.zplit-${timestamp}.XXXXXX.partial")
manifest_partial=''
dump_final_created=''
manifest_final_created=''
cleanup() {
  rm -f -- "$dump_partial" "$manifest_partial"
  if [[ -n $dump_final_created ]]; then rm -f -- "$dump_path"; fi
  if [[ -n $manifest_final_created ]]; then rm -f -- "$manifest_path"; fi
}
trap cleanup EXIT

"${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_password)" pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-privileges --serializable-deferrable' > "$dump_partial"
"${compose[@]}" exec -T postgres sh -c 'archive=$(mktemp); trap "rm -f \\\"$archive\\\"" EXIT; cat > "$archive"; pg_restore --list "$archive"' < "$dump_partial" > /dev/null

postgres_version=$("${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_password)" psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --quiet -c "SHOW server_version"' | tr -d '\r\n' | cut -d ' ' -f1)
if [[ ! $postgres_version =~ ^[0-9]+([.][0-9]+)*$ ]]; then
  echo "backup metadata was invalid" >&2
  exit 1
fi

dump_sha256=$(sha256sum "$dump_partial" | awk '{print $1}')
dump_byte_length=$(stat -c '%s' -- "$dump_partial")
manifest_partial=$(mktemp "$backup_dir/.zplit-${timestamp}.XXXXXX.partial")
printf '%s\n' "{\"formatVersion\":1,\"createdAt\":\"$created_at\",\"gitCommit\":\"$database_schema_commit\",\"postgresqlServerVersion\":\"$postgres_version\",\"dumpSha256\":\"$dump_sha256\",\"dumpByteLength\":$dump_byte_length,\"dumpFilename\":\"$dump_filename\"}" > "$manifest_partial"
chmod 600 "$dump_partial" "$manifest_partial"
ln -- "$dump_partial" "$dump_path"
dump_final_created=1
ln -- "$manifest_partial" "$manifest_path"
manifest_final_created=1
rm -f -- "$dump_partial" "$manifest_partial"
dump_partial=''
manifest_partial=''
dump_final_created=''
manifest_final_created=''

echo "backup created: $dump_path"
echo "manifest created: $manifest_path"
