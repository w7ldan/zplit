#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 || $1 != /* ]]; then
  echo "usage: $0 /absolute/path/to/zplit-YYYYMMDDTHHMMSSZ.dump" >&2
  exit 2
fi

dump_path=$1
dump_filename=$(basename -- "$dump_path")
manifest_path="${dump_path%.dump}.json"
manifest_filename=$(basename -- "$manifest_path")
if [[ ! $dump_filename =~ ^zplit-[0-9]{8}T[0-9]{6}Z\.dump$ || $manifest_filename != "${dump_filename%.dump}.json" ]]; then
  echo "backup filename is malformed" >&2
  exit 1
fi
if [[ -L "$dump_path" || ! -f "$dump_path" || -L "$manifest_path" || ! -f "$manifest_path" ]]; then
  echo "backup and adjacent manifest must be regular, non-symlink files" >&2
  exit 1
fi
for file in "$dump_path" "$manifest_path"; do
  mode=$(stat -c '%a' -- "$file")
  if [[ ! $mode =~ ^[0-7]{3}$ || ${mode:1:1} =~ [2367] || ${mode:2:1} =~ [2367] ]]; then
    echo "backup files must not be group- or world-writable" >&2
    exit 1
  fi
done

manifest_fields=$(node --input-type=module - "$manifest_path" "$dump_filename" <<'NODE'
import { readFileSync } from "node:fs";

const [manifestPath, expectedFilename] = process.argv.slice(2);
const value = JSON.parse(readFileSync(manifestPath, "utf8"));
const expectedKeys = ["createdAt", "dumpByteLength", "dumpFilename", "dumpSha256", "formatVersion", "gitCommit", "postgresqlServerVersion"];
if (!value || typeof value !== "object" || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) throw new Error("invalid manifest fields");
if (value.formatVersion !== 1 || typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.createdAt)) throw new Error("invalid manifest version or timestamp");
if (typeof value.gitCommit !== "string" || !/^[0-9a-f]{40}$/.test(value.gitCommit)) throw new Error("invalid manifest commit");
if (typeof value.postgresqlServerVersion !== "string" || !/^[0-9]+(?:\.[0-9]+)*$/.test(value.postgresqlServerVersion)) throw new Error("invalid manifest server version");
if (typeof value.dumpSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.dumpSha256)) throw new Error("invalid manifest hash");
if (!Number.isSafeInteger(value.dumpByteLength) || value.dumpByteLength < 1) throw new Error("invalid manifest byte length");
if (value.dumpFilename !== expectedFilename) throw new Error("manifest filename mismatch");
process.stdout.write([value.dumpSha256, value.dumpByteLength, value.gitCommit].join("\t"));
NODE
)
IFS=$'\t' read -r expected_sha256 expected_byte_length manifest_git_commit <<< "$manifest_fields"
if ! git cat-file -e "${manifest_git_commit}^{commit}" 2>/dev/null; then
  echo "backup manifest commit does not exist locally" >&2
  exit 1
fi
actual_sha256=$(sha256sum "$dump_path" | awk '{print $1}')
actual_byte_length=$(stat -c '%s' -- "$dump_path")
if [[ $actual_sha256 != "$expected_sha256" ]]; then
  echo "backup SHA-256 mismatch" >&2
  exit 1
fi
if [[ $actual_byte_length != "$expected_byte_length" ]]; then
  echo "backup byte length mismatch" >&2
  exit 1
fi

compose_image='postgres:18.4-bookworm@sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296'
network_name="zplit-backup-verify-${RANDOM}-${RANDOM}"
container_name="zplit-backup-verify-${RANDOM}-${RANDOM}"
password_file=$(mktemp)
chmod 600 "$password_file"
printf '%s' "$(openssl rand -hex 32)" > "$password_file"
network_created=''
container_started=''
cleanup() {
  if [[ -n $container_started ]]; then docker rm -f "$container_name" >/dev/null 2>&1 || true; fi
  if [[ -n $network_created ]]; then docker network rm "$network_name" >/dev/null 2>&1 || true; fi
  rm -f -- "$password_file"
  unset restore_password
}
trap cleanup EXIT
restore_password=$(<"$password_file")
docker network create --internal "$network_name" >/dev/null
network_created=1
docker run -d --name "$container_name" --network "$network_name" --tmpfs /var/lib/postgresql/18/docker:rw,noexec,nosuid,size=1g -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$restore_password" -e POSTGRES_DB=postgres "$compose_image" >/dev/null
container_started=1

for attempt in $(seq 1 60); do
  if docker exec "$container_name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' >/dev/null 2>&1; then break; fi
  if [[ $attempt -eq 60 ]]; then
    echo "disposable PostgreSQL did not become ready" >&2
    exit 1
  fi
  sleep 1
done
docker exec "$container_name" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE zplit_restore_test' >/dev/null
docker exec -i "$container_name" pg_restore --exit-on-error --no-owner --no-privileges --username=postgres --dbname=zplit_restore_test < "$dump_path"

restore_host=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container_name")
if [[ ! $restore_host =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
  echo "could not determine disposable PostgreSQL address" >&2
  exit 1
fi
ZPLIT_BACKUP_GIT_COMMIT="$manifest_git_commit" DB_HOST="$restore_host" DB_PORT=5432 DB_NAME=zplit_restore_test DB_USER=postgres DB_PASSWORD_FILE="$password_file" ./node_modules/.bin/tsx scripts/backup-integrity.ts
echo "backup verification passed"
