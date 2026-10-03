#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 || "$1" != /* ]]; then
  echo "Usage: scripts/backup-production.sh /absolute/private/backup/directory" >&2
  exit 2
fi

destination="$1"
mkdir -p -- "$destination"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="$destination/eventos-$stamp"
mkdir -- "$run_dir"

compose=(docker compose --env-file .env.production -f compose.production.yaml)
dump_db() {
  local database="$1"
  local output="$run_dir/$database.dump"
  "${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -Fc --no-owner --no-acl "$1"' sh "$database" > "$output"
  [[ -s "$output" ]] || { echo "Backup failed for $database" >&2; exit 1; }
  "${compose[@]}" exec -T postgres pg_restore --list < "$output" > /dev/null
}

dump_db eventos_control
registry_file="$run_dir/tenant-databases.txt"
"${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -U "$POSTGRES_USER" -d eventos_control -At -v ON_ERROR_STOP=1 -c "SELECT database_name FROM tenant_database_registry ORDER BY database_name"' > "$registry_file"
while IFS= read -r database; do
  [[ "$database" =~ ^eventos_t_[0-9a-f]{32}$ ]] || { echo "Invalid tenant database name in registry" >&2; exit 1; }
  dump_db "$database"
done < "$registry_file"

echo "Backup files verified in $run_dir"
