#!/usr/bin/env bash
# Host-only one-shot orchestration. No Docker socket or backup mount in application.
set -euo pipefail
umask 077
[[ $# -eq 2 && "$1" =~ ^/[A-Za-z0-9_./-]+$ && "$2" =~ ^/[A-Za-z0-9_./-]+$ && -d "$2" ]] || exit 2
release="$1"; destination="$2"
compose=(docker compose --project-name eventos-production --env-file "$release/deployment/windows-iis/.env.production" -f "$release/deployment/windows-iis/compose.production.yaml")
control() { "${compose[@]}" exec -T app node --conditions=react-server --import=tsx scripts/backup-job-control.ts "$@"; }
parse() { "${compose[@]}" exec -T app node --input-type=module -e "$1" "${@:2}" 2>/dev/null; }
claim="$(control claim 2>/dev/null)" || { echo 'Backup claim failed safely.' >&2; exit 1; }
if [[ "$claim" == '{"data":null}' ]]; then
  if [[ "${EVENTOS_BACKUP_RESULT_JSON:-0}" == 1 ]]; then echo '{"data":null}'; else echo 'No queued manual backup job.'; fi
  exit 0
fi
context="$(parse 'let t="";for await(const p of process.stdin)t+=p;const j=JSON.parse(t).data;const u=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;if(!u.test(j.id)||!(["FULL_PLATFORM","TENANT"].includes(j.scope))||(j.scope==="TENANT"&&!u.test(j.tenantId)))process.exit(1);console.log([j.id,j.scope,j.tenantId||"-"].join(" "))' <<< "$claim")"
read -r job scope tenant <<< "$context"
failed() { control fail "$job" >/dev/null 2>&1 || true; echo 'Backup job failed; partial archives retained. Job control must be checked if failure recording was unavailable.' >&2; }
trap failed ERR
if [[ "$scope" == FULL_PLATFORM ]]; then
  output="$(EVENTOS_BACKUP_JOB_ID="$job" bash "$release/deployment/windows-iis/backup.sh" "$release" "$destination" 2>/dev/null)"
  run_dir="${output##*$'\n'}"; run_dir="${run_dir#Backup archives verified (not a restore rehearsal): }"
else
  output="$(bash "$release/deployment/windows-iis/backup-tenant.sh" "$release" "$destination" "$tenant" "$job" 2>/dev/null)"
  run_dir="${output##*$'\n'}"; run_dir="${run_dir#Tenant backup archives verified (not a restore rehearsal): }"
fi
key="${run_dir##*/}"
[[ "$key" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$ && "$run_dir" == "$destination/$key" && -d "$run_dir" && ! -L "$run_dir" ]]
control mark-verifying "$job" >/dev/null 2>&1
(cd "$run_dir" && sha256sum -c SHA256SUMS >/dev/null 2>&1)
parse 'let t="";for await(const p of process.stdin)t+=p;const m=JSON.parse(t);if(m.formatVersion!==1||m.jobId!==process.argv[1]||m.scope!==process.argv[2]||!Number.isInteger(m.tenantCount)||m.tenantCount<0||!["local","s3"].includes(m.mediaDriver)||!Number.isFinite(Date.parse(m.createdAt))||(m.scope==="TENANT"&&(m.tenantId!==process.argv[3]||m.tenantCount!==1||m.mediaDriver!=="local")))process.exit(1)' "$job" "$scope" "$tenant" < "$run_dir/manifest.json"
if [[ "$scope" == FULL_PLATFORM ]]; then
  [[ -s "$run_dir/eventos_control.dump" && -f "$run_dir/tenant-databases.txt" ]]
  parse 'let t="";for await(const p of process.stdin)t+=p;if(JSON.parse(t).tenantCount!==Number(process.argv[1]))process.exit(1)' "$(wc -l < "$run_dir/tenant-databases.txt")" < "$run_dir/manifest.json"
  "${compose[@]}" exec -T postgres pg_restore --list < "$run_dir/eventos_control.dump" >/dev/null 2>&1
  while IFS= read -r db; do
    [[ "$db" =~ ^eventos_t_[0-9a-f]{32}$ && -s "$run_dir/$db.dump" ]]
    "${compose[@]}" exec -T postgres pg_restore --list < "$run_dir/$db.dump" >/dev/null 2>&1
  done < "$run_dir/tenant-databases.txt"
else
  [[ -s "$run_dir/tenant.dump" ]]
  "${compose[@]}" exec -T postgres pg_restore --list < "$run_dir/tenant.dump" >/dev/null 2>&1
  parse 'let t="";for await(const p of process.stdin)t+=p;const m=JSON.parse(t).data;if(m.tenant.id!==process.argv[1])process.exit(1)' "$tenant" < "$run_dir/control-metadata.json"
fi
if [[ -f "$run_dir/media.tar.gz" ]]; then
  gzip -t -- "$run_dir/media.tar.gz" 2>/dev/null; tar -tzf "$run_dir/media.tar.gz" >/dev/null 2>&1
  if [[ "$scope" == TENANT ]]; then
    while IFS= read -r entry; do [[ "$entry" == "tenants/$tenant/"* && "$entry" != *../* && "$entry" != /* ]]; done < <(tar -tzf "$run_dir/media.tar.gz")
  fi
else
  [[ "$scope" == FULL_PLATFORM ]]
  parse 'let t="";for await(const p of process.stdin)t+=p;if(JSON.parse(t).mediaDriver!=="s3")process.exit(1)' < "$run_dir/manifest.json"
fi
size="$(find "$run_dir" -maxdepth 1 -type f -printf '%s\n' | awk '{sum+=$1} END {printf "%.0f",sum}')"
control complete "$job" "$key" "$size" >/dev/null 2>&1
trap - ERR
if [[ "${EVENTOS_BACKUP_RESULT_JSON:-0}" == 1 ]]; then
  printf '{"data":{"id":"%s"}}\n' "$job"
else
  echo 'Backup job succeeded; archives and checksums verified (not a restore rehearsal).'
fi
