#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# -eq 2 && "$1" =~ ^/[A-Za-z0-9_./-]+$ && "$2" =~ ^/[A-Za-z0-9_./-]+$ && -d "$2" && ! -L "$2" ]] || exit 2
release="$1"; root="$2"
compose=(docker compose --project-name eventos-production --env-file "$release/deployment/windows-iis/.env.production" -f "$release/deployment/windows-iis/compose.production.yaml")
control() { "${compose[@]}" exec -T app node --conditions=react-server --import=tsx scripts/backup-job-control.ts "$@" 2>/dev/null; }
parse() { "${compose[@]}" exec -T app node --input-type=module -e "$1" 2>/dev/null; }
[[ "$(realpath -e -- "$root")" == "${root%/}" && ! -L "$root/.eventos-maintenance.lock" ]] || exit 2
exec 9> "$root/.eventos-maintenance.lock"
flock -n 9 || { echo 'EventOS backup maintenance already active.'; exit 0; }
control enqueue-due >/dev/null || { echo 'Schedule evaluation failed safely.' >&2; exit 1; }
result="$(EVENTOS_BACKUP_RESULT_JSON=1 bash "$release/deployment/windows-iis/run-backup-job.sh" "$release" "$root" 2>/dev/null)" || { echo 'Backup failed; retention not executed.' >&2; exit 1; }
job="$(parse 'let t="";for await(const p of process.stdin)t+=p;const j=JSON.parse(t).data;if(j&&!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(j.id))process.exit(1);process.stdout.write(j?j.id:"")' <<< "$result")"
if [[ -n "$job" ]]; then candidates="$(control retention "$job")"; else candidates="$(control retry-prunes)"; fi
selection="$(parse 'let t="";for await(const p of process.stdin)t+=p;const rows=JSON.parse(t).data;if(!Array.isArray(rows)||rows.length>10)process.exit(1);for(const r of rows){if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(r.id)||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(r.backupKey))process.exit(1);console.log(r.id+" "+r.backupKey)}' <<< "$candidates")"
count=0
while read -r id key; do
  [[ -n "$id" ]] || continue
  (( count+=1 )); (( count<=10 )) || exit 1
  if ! control check-prune "$id" "$key" >/dev/null; then echo 'Retention candidate unavailable; skipped.'; continue; fi
  if bash "$release/deployment/windows-iis/prune-backup.sh" "$root" "$key" --selected-job "$id" >/dev/null 2>&1; then
    control mark-pruned "$id" "$key" >/dev/null || { echo 'Deletion completed; database marking failed. Authorized retry required.' >&2; exit 1; }
  else
    echo 'Retention deletion failed; successful job state retained for retry.' >&2
    exit 1
  fi
done <<< "$selection"
echo 'EventOS backup maintenance completed (at most one job and ten deletions).'
