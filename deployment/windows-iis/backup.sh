#!/usr/bin/env bash
set -euo pipefail
set -o noclobber
umask 077
[[ $# -eq 2 && "$1" =~ ^/[a-zA-Z0-9_./-]+$ && "$2" =~ ^/[a-zA-Z0-9_./-]+$ && -d "$2" ]] || { echo 'Absolute release and existing private backup directory required' >&2; exit 2; }
release="$1"
run_dir="$2/eventos-$(date -u +%Y%m%dT%H%M%SZ)-$(cat /proc/sys/kernel/random/uuid)"
mkdir -- "$run_dir" # fail if directory exists; never overwrite
compose=(docker compose --project-name eventos-production --env-file "$release/deployment/windows-iis/.env.production" -f "$release/deployment/windows-iis/compose.production.yaml")
dump_db() {
  local database="$1"
  "${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -Fc --no-owner --no-acl "$1"' sh "$database" > "$run_dir/$database.dump"
  [[ -s "$run_dir/$database.dump" ]] || { echo 'Empty backup; stop and investigate' >&2; exit 1; }
  "${compose[@]}" exec -T postgres pg_restore --list < "$run_dir/$database.dump" > /dev/null
}
dump_db eventos_control
"${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -U "$POSTGRES_USER" -d eventos_control -At -v ON_ERROR_STOP=1 -c "SELECT database_name FROM tenant_database_registry ORDER BY database_name"' > "$run_dir/tenant-databases.txt"
while IFS= read -r database; do
  [[ "$database" =~ ^eventos_t_[0-9a-f]{32}$ ]] || { echo 'Invalid EventOS registry database; abort' >&2; exit 1; }
  dump_db "$database"
done < "$run_dir/tenant-databases.txt"
driver="$("${compose[@]}" exec -T app sh -c 'printf %s "$MEDIA_STORAGE_DRIVER"')"
if [[ "$driver" == local ]]; then
  app_id="$("${compose[@]}" ps -q app)"
  [[ "$app_id" =~ ^[0-9a-f]{12,64}$ ]] || { echo 'Exact EventOS app container required' >&2; exit 1; }
  media_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data/media"}}{{.Name}}{{end}}{{end}}' "$app_id")"
  [[ "$media_volume" == eventos-production_media ]] || { echo 'EventOS media mount mismatch; backup aborted' >&2; exit 1; }
  "${compose[@]}" exec -T app node --conditions=react-server --import=tsx scripts/backup-local-media.ts > "$run_dir/media.tar.gz"
  [[ -s "$run_dir/media.tar.gz" ]] || { echo 'Empty media archive; backup failed' >&2; exit 1; }
  gzip -t -- "$run_dir/media.tar.gz"
  tar -tzf "$run_dir/media.tar.gz" > /dev/null
  printf 'EventOS media backup bytes: %s\n' "$(stat -c %s -- "$run_dir/media.tar.gz")"
elif [[ "$driver" != s3 ]]; then
  echo 'Unknown media driver; backup aborted' >&2; exit 1
fi
(cd "$run_dir" && sha256sum -- ./*.dump $( [[ "$driver" != local ]] || printf '%s' './media.tar.gz' ) > SHA256SUMS)
printf 'Backup archives verified (not a restore rehearsal): %s\n' "$run_dir"
