#!/usr/bin/env bash
set -euo pipefail
set -o noclobber
umask 077
uuid='^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
[[ $# -eq 4 && "$1" =~ ^/[A-Za-z0-9_./-]+$ && "$2" =~ ^/[A-Za-z0-9_./-]+$ && -d "$2" && "$3" =~ $uuid && "$4" =~ $uuid ]] || exit 2
release="$1"; tenant="$3"; job="$4"
compose=(docker compose --project-name eventos-production --env-file "$release/deployment/windows-iis/.env.production" -f "$release/deployment/windows-iis/compose.production.yaml")
run_dir="$2/tenant-$tenant-$(date -u +%Y%m%dT%H%M%SZ)-$(cat /proc/sys/kernel/random/uuid)"
mkdir -- "$run_dir"
"${compose[@]}" exec -T app node --conditions=react-server --import=tsx scripts/backup-job-control.ts metadata "$tenant" > "$run_dir/control-metadata.json"
# Explicit metadata schema/identity validation; trusted registry name, never a browser argument.
database="$("${compose[@]}" exec -T app node --input-type=module -e 'let text="";for await(const part of process.stdin)text+=part;const m=JSON.parse(text).data;if(m.tenant.id!==process.argv[1]||!/^eventos_t_[0-9a-f]{32}$/.test(m.registry.databaseName))process.exit(1);process.stdout.write(m.registry.databaseName)' "$tenant" < "$run_dir/control-metadata.json")"
[[ "$database" =~ ^eventos_t_[0-9a-f]{32}$ ]] || exit 1
"${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -Fc --no-owner --no-acl "$1"' sh "$database" > "$run_dir/tenant.dump"
[[ -s "$run_dir/tenant.dump" ]] || exit 1
"${compose[@]}" exec -T postgres pg_restore --list < "$run_dir/tenant.dump" > /dev/null
driver="$("${compose[@]}" exec -T app sh -c 'printf %s "$MEDIA_STORAGE_DRIVER"')"
# S3 export is deliberately unavailable: never claim an incomplete tenant media backup.
[[ "$driver" == local ]] || { echo 'Tenant backup requires local media; S3 export unavailable.' >&2; exit 1; }
app_id="$("${compose[@]}" ps -q app)"
[[ "$app_id" =~ ^[0-9a-f]{12,64}$ ]] || exit 1
volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data/media"}}{{.Name}}{{end}}{{end}}' "$app_id")"
[[ "$volume" == eventos-production_media ]] || exit 1
"${compose[@]}" exec -T app node --conditions=react-server --import=tsx scripts/backup-local-media.ts --tenant-id "$tenant" > "$run_dir/media.tar.gz"
gzip -t -- "$run_dir/media.tar.gz"; tar -tzf "$run_dir/media.tar.gz" > /dev/null
printf '{"formatVersion":1,"scope":"TENANT","jobId":"%s","tenantId":"%s","createdAt":"%s","tenantCount":1,"mediaDriver":"local"}\n' "$job" "$tenant" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$run_dir/manifest.json"
(cd "$run_dir" && sha256sum -- tenant.dump control-metadata.json media.tar.gz manifest.json > SHA256SUMS)
printf 'Tenant backup archives verified (not a restore rehearsal): %s\n' "$run_dir"
