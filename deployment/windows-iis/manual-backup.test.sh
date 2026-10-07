#!/usr/bin/env bash
# Every Docker command is mocked. No daemon, live server or real database backup.
set -euo pipefail
fixture="$(mktemp -d /tmp/eventos-manual-backup-test.XXXXXX)"
[[ "$fixture" == /tmp/eventos-manual-backup-test.* ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/backups" "$fixture/media/tenants/11111111-1111-4111-8111-111111111111/website"
printf 'tenant A bytes' > "$fixture/media/tenants/11111111-1111-4111-8111-111111111111/website/object"
tar -czf "$fixture/media.tar.gz" -C "$fixture/media" tenants/11111111-1111-4111-8111-111111111111/website/object
export EVENTOS_MANUAL_FIXTURE="$fixture"
export EVENTOS_TEST_NODE="${EVENTOS_TEST_NODE:-node}"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == 'compose --project-name eventos-production '* || "$*" == 'inspect --format '* ]] || exit 99
printf '%s\n' "$*" >> "$EVENTOS_MANUAL_FIXTURE/calls"
case "$*" in
  'inspect --format '*) echo eventos-production_media ;;
  *'scripts/backup-job-control.ts claim')
    if [[ "${EVENTOS_EMPTY:-0}" == 1 ]]; then echo '{"data":null}'; else
      printf '{"data":{"id":"22222222-2222-4222-8222-222222222222","scope":"%s","tenantId":"11111111-1111-4111-8111-111111111111"}}\n' "$EVENTOS_SCOPE"
    fi ;;
  *'scripts/backup-job-control.ts mark-verifying '*)
    echo VERIFYING >> "$EVENTOS_MANUAL_FIXTURE/states"
    if [[ "${EVENTOS_CHECKSUM_FAIL:-0}" == 1 ]]; then
      latest="$(find "$EVENTOS_MANUAL_FIXTURE/backups" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
      printf corrupt >> "$latest/tenant.dump"
    fi
    echo '{"data":{}}' ;;
  *'scripts/backup-job-control.ts complete '*)
    [[ "$(tail -n 1 "$EVENTOS_MANUAL_FIXTURE/states")" == VERIFYING ]]
    echo SUCCEEDED >> "$EVENTOS_MANUAL_FIXTURE/states"; echo '{"data":{}}' ;;
  *'scripts/backup-job-control.ts fail '*) echo FAILED >> "$EVENTOS_MANUAL_FIXTURE/states"; echo '{"data":{}}' ;;
  *'scripts/backup-job-control.ts metadata '*)
    printf '{"data":{"tenant":{"id":"11111111-1111-4111-8111-111111111111"},"registry":{"databaseName":"%s"}}}\n' "${EVENTOS_DB:-eventos_t_11111111111141118111111111111111}" ;;
  *'exec -T app node --input-type=module -e '*)
    while [[ "$1" != node ]]; do shift; done
    shift; "$EVENTOS_TEST_NODE" "$@" ;;
  *'exec -T postgres '*pg_dump*) printf 'synthetic database dump' ;;
  *'exec -T postgres pg_restore --list')
    cat >/dev/null; [[ "${EVENTOS_VERIFY_FAIL:-0}" == 0 ]] ;;
  *'exec -T postgres '*psql*) echo eventos_t_11111111111141118111111111111111 ;;
  *'exec -T app sh -c '*MEDIA_STORAGE_DRIVER*) printf local ;;
  *'ps -q app') echo aaaaaaaaaaaa ;;
  *'scripts/backup-local-media.ts'*) cat "$EVENTOS_MANUAL_FIXTURE/media.tar.gz" ;;
  *) exit 98 ;;
esac
MOCK
chmod 700 "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
release="$(pwd)"
for scope in FULL_PLATFORM TENANT; do
  export EVENTOS_SCOPE="$scope"
  bash deployment/windows-iis/run-backup-job.sh "$release" "$fixture/backups" > /dev/null
  [[ "$(tail -n 2 "$fixture/states" | tr '\n' ' ')" == 'VERIFYING SUCCEEDED ' ]]
done
full="$(find "$fixture/backups" -maxdepth 1 -name 'eventos-*' -type d)"
tenant="$(find "$fixture/backups" -maxdepth 1 -name 'tenant-*' -type d)"
[[ -s "$full/eventos_control.dump" && -s "$full/manifest.json" && -s "$tenant/tenant.dump" && -s "$tenant/control-metadata.json" ]]
(cd "$full" && sha256sum -c SHA256SUMS >/dev/null)
(cd "$tenant" && sha256sum -c SHA256SUMS >/dev/null)
[[ "$(tar -tzf "$tenant/media.tar.gz")" == tenants/11111111-1111-4111-8111-111111111111/website/object ]]
EVENTOS_EMPTY=1 bash deployment/windows-iis/run-backup-job.sh "$release" "$fixture/backups" | grep -q 'No queued'
if EVENTOS_VERIFY_FAIL=1 bash deployment/windows-iis/run-backup-job.sh "$release" "$fixture/backups" >/dev/null 2>&1; then exit 1; fi
[[ "$(tail -n 1 "$fixture/states")" == FAILED ]]
if EVENTOS_CHECKSUM_FAIL=1 bash deployment/windows-iis/run-backup-job.sh "$release" "$fixture/backups" >/dev/null 2>&1; then exit 1; fi
[[ "$(tail -n 2 "$fixture/states" | tr '\n' ' ')" == 'VERIFYING FAILED ' ]]
if EVENTOS_DB='not_safe' bash deployment/windows-iis/run-backup-job.sh "$release" "$fixture/backups" >/dev/null 2>&1; then exit 1; fi
[[ "$(tail -n 1 "$fixture/states")" == FAILED ]]
# Corrupting an archive invalidates the checksum independently of pg_restore mocks.
printf 'corruption' >> "$tenant/tenant.dump"
if (cd "$tenant" && sha256sum -c SHA256SUMS >/dev/null 2>&1); then exit 1; fi
printf 'PASS: full/tenant manifests, checksums, isolated media, state verification, failure, registry rejection and empty queue; Docker fully mocked.\n'
