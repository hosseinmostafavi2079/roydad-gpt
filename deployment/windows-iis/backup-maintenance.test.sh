#!/usr/bin/env bash
# Temp roots and mocked Docker/backup execution only. No live deletion or task install.
set -euo pipefail
fixture="$(mktemp -d /tmp/eventos-maintenance-test.XXXXXX)"
[[ "$fixture" == /tmp/eventos-maintenance-test.* ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
root="$fixture/backups"; release="$fixture/release"
mkdir -m 700 "$root" "$fixture/outside" "$fixture/bin"
mkdir -p "$release/deployment/windows-iis"
cp deployment/windows-iis/prune-backup.sh "$release/deployment/windows-iis/"
job='11111111-1111-4111-8111-111111111111'
key="eventos-20260101T000000Z-$job"
mkdir "$root/$key"; printf '{"jobId":"%s","scope":"FULL_PLATFORM"}' "$job" > "$root/$key/manifest.json"
bash deployment/windows-iis/prune-backup.sh "$root" "$key" --selected-job "$job" >/dev/null
[[ ! -e "$root/$key" ]]
bash deployment/windows-iis/prune-backup.sh "$root" "$key" --selected-job "$job" >/dev/null
for bad in /tmp ../escape . '' 'pricepilot-backup' 'eventos-*'; do
  if bash deployment/windows-iis/prune-backup.sh "$root" "$bad" --selected-job "$job" >/dev/null 2>&1; then exit 1; fi
done
ln -s "$fixture/outside" "$root/$key"
if bash deployment/windows-iis/prune-backup.sh "$root" "$key" --selected-job "$job" >/dev/null 2>&1; then exit 1; fi
rm -- "$root/$key" # Remove fixture symlink only; preserve outside target.
[[ -d "$fixture/outside" ]]
ln -s "$root" "$fixture/root-link"
if bash deployment/windows-iis/prune-backup.sh "$fixture/root-link" "$key" --selected-job "$job" >/dev/null 2>&1; then exit 1; fi
cat > "$release/deployment/windows-iis/run-backup-job.sh" <<'MOCK'
#!/usr/bin/env bash
[[ "${EVENTOS_FAIL_BACKUP:-0}" == 0 ]] || exit 1
if [[ "${EVENTOS_NO_JOB:-0}" == 1 ]]; then echo '{"data":null}'; else echo '{"data":{"id":"22222222-2222-4222-8222-222222222222"}}'; fi
MOCK
export EVENTOS_MAINTENANCE_FIXTURE="$fixture"
export EVENTOS_TEST_NODE="${EVENTOS_TEST_NODE:-node}"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == 'compose --project-name eventos-production '* ]] || exit 99
printf '%s\n' "$*" >> "$EVENTOS_MAINTENANCE_FIXTURE/calls"
case "$*" in
  *'backup-job-control.ts enqueue-due') echo '{"data":null}' ;;
  *'backup-job-control.ts retention '*|*'backup-job-control.ts retry-prunes') echo '{"data":[{"id":"11111111-1111-4111-8111-111111111111","backupKey":"eventos-20260101T000000Z-11111111-1111-4111-8111-111111111111"}]}' ;;
  *'backup-job-control.ts check-prune '*) [[ "${EVENTOS_UNAUTHORIZED:-0}" == 0 ]]; echo '{"data":{}}' ;;
  *'backup-job-control.ts mark-pruned '*) echo PRUNED >> "$EVENTOS_MAINTENANCE_FIXTURE/states"; echo '{"data":{}}' ;;
  *'exec -T app node --input-type=module -e '*) while [[ "$1" != node ]]; do shift; done; shift; "$EVENTOS_TEST_NODE" "$@" ;;
  *) exit 98 ;;
esac
MOCK
chmod 700 "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
mkdir "$root/$key"
printf '{"jobId":"%s","scope":"FULL_PLATFORM"}' "$job" > "$root/$key/manifest.json"
bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null
[[ ! -e "$root/$key" && "$(cat "$fixture/states")" == PRUNED ]]
# Proven candidate already absent after a DB-marking failure: bounded authorized retry.
EVENTOS_NO_JOB=1 bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null
[[ "$(wc -l < "$fixture/states")" == 2 ]]
if EVENTOS_FAIL_BACKUP=1 bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null 2>&1; then exit 1; fi
[[ "$(wc -l < "$fixture/states")" == 2 ]]
# No proof, no deletion or database marking, even for an otherwise valid name.
mkdir "$root/$key"
EVENTOS_UNAUTHORIZED=1 bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null
[[ -d "$root/$key" && "$(wc -l < "$fixture/states")" == 2 ]]
rmdir -- "$root/$key"
ln -s "$fixture/outside" "$root/$key"
if bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null 2>&1; then exit 1; fi
[[ "$(wc -l < "$fixture/states")" == 2 && -d "$fixture/outside" ]]
printf 'PASS: exact-child prune, traversal/root/unrelated/symlink rejection, authorized absent retry, failed backups/deletion never mark PRUNED; Docker fully mocked.\n'
