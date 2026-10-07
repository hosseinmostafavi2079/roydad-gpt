#!/usr/bin/env bash
# Disposable private fixture directories; all host Docker/control operations mocked.
set -euo pipefail
fixture="$(mktemp -d /tmp/eventos-delete-test.XXXXXX)"
[[ "$fixture" == /tmp/eventos-delete-test.* ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
root="$fixture/backups"; release="$fixture/release"
mkdir -m 700 "$root" "$fixture/bin" "$fixture/outside"
mkdir -p "$release/deployment/windows-iis"
cp deployment/windows-iis/prune-backup.sh "$release/deployment/windows-iis/"
printf '#!/usr/bin/env bash\necho '\''{"data":null}'\''\n' > "$release/deployment/windows-iis/run-backup-job.sh"
export EVENTOS_DELETE_FIXTURE="$fixture"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == 'compose --project-name eventos-production '* ]] || exit 99
printf '%s\n' "$*" >> "$EVENTOS_DELETE_FIXTURE/calls"
case "$*" in
  *'backup-job-control.ts enqueue-due') echo '{"data":null}' ;;
  *'backup-job-control.ts retry-prunes') echo '{"data":[]}' ;;
  *'backup-job-control.ts claim-delete')
    number="$(cat "$EVENTOS_DELETE_FIXTURE/count")"
    [[ "$number" -lt "${EVENTOS_DELETE_TOTAL:-1}" ]] || { echo '{"data":null}'; exit 0; }
    ((number+=1)); echo "$number" > "$EVENTOS_DELETE_FIXTURE/count"
    printf -v uuid '11111111-1111-4111-8111-%012d' "$number"
    key="eventos-20260101T000000Z-$uuid"
    [[ "${EVENTOS_DELETE_BAD_KEY:-0}" == 0 ]] || key='../outside'
    printf '{"data":{"id":"%s","backupJobId":"%s","backupKey":"%s","scope":"FULL_PLATFORM","tenantId":null}}\n' "$uuid" "$uuid" "$key" ;;
  *'backup-job-control.ts check-delete '*) [[ "${EVENTOS_DELETE_UNAUTHORIZED:-0}" == 0 ]]; echo '{"data":{}}' ;;
  *'backup-job-control.ts complete-delete '*) [[ "${EVENTOS_DELETE_COMPLETE_FAILURE:-0}" == 0 ]]; echo SUCCEEDED >> "$EVENTOS_DELETE_FIXTURE/states"; echo '{"data":{}}' ;;
  *'backup-job-control.ts fail-delete '*) echo FAILED >> "$EVENTOS_DELETE_FIXTURE/states"; echo '{"data":{}}' ;;
  *'exec -T app node --input-type=module -e '*) while [[ "$1" != node ]]; do shift; done; shift; node "$@" ;;
  *) exit 98 ;;
esac
MOCK
chmod 700 "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
job='11111111-1111-4111-8111-000000000001'; key="eventos-20260101T000000Z-$job"
reset() { echo 0 > "$fixture/count"; : > "$fixture/states"; : > "$fixture/calls"; }
archive() { mkdir "$root/$2"; printf '{"jobId":"%s","scope":"FULL_PLATFORM"}' "$1" > "$root/$2/manifest.json"; }
reset; archive "$job" "$key"
bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null
[[ ! -e "$root/$key" && "$(cat "$fixture/states")" == SUCCEEDED ]]
schedule_line="$(grep -n 'enqueue-due' "$fixture/calls" | cut -d: -f1)"
retention_line="$(grep -n 'retry-prunes' "$fixture/calls" | cut -d: -f1)"
manual_line="$(grep -n 'claim-delete' "$fixture/calls" | head -n1 | cut -d: -f1)"
(( schedule_line < retention_line && retention_line < manual_line ))
# Wrong manifest identity must retain the directory and record only deletion failure.
reset; archive '22222222-2222-4222-8222-222222222222' "$key"
bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null
[[ -d "$root/$key" && "$(cat "$fixture/states")" == FAILED ]]
rm -rf -- "$root/$key"
reset; ln -s "$fixture/outside" "$root/$key"
bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null
[[ -L "$root/$key" && -d "$fixture/outside" && "$(cat "$fixture/states")" == FAILED ]]
rm -- "$root/$key"
reset; archive "$job" "$key"
EVENTOS_DELETE_UNAUTHORIZED=1 bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null
[[ -d "$root/$key" && "$(cat "$fixture/states")" == FAILED ]]
reset
if EVENTOS_DELETE_BAD_KEY=1 bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null 2>&1; then exit 1; fi
[[ -d "$root/$key" && ! -s "$fixture/states" ]]
# Marking failure stops processing; no misleading FAILED after physical removal.
reset
if EVENTOS_DELETE_COMPLETE_FAILURE=1 bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null 2>&1; then exit 1; fi
[[ ! -e "$root/$key" && ! -s "$fixture/states" && "$(cat "$fixture/count")" == 1 ]]
# Eight queued requests process only five; later directories remain untouched.
reset
for ((n=1;n<=8;n++)); do printf -v id '11111111-1111-4111-8111-%012d' "$n"; archive "$id" "eventos-20260101T000000Z-$id"; done
EVENTOS_DELETE_TOTAL=8 bash deployment/windows-iis/run-backup-maintenance.sh "$release" "$root" >/dev/null
[[ "$(cat "$fixture/count")" == 5 && "$(wc -l < "$fixture/states")" == 5 ]]
[[ "$(find "$root" -mindepth 1 -maxdepth 1 -type d | wc -l)" == 3 ]]
printf 'PASS: manual deletion order, physical success, wrong manifest, symlink, traversal, authorization failure, marking failure stop and five-request bound; all Docker calls mocked.\n'
