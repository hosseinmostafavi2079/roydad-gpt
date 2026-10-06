#!/usr/bin/env bash
# Artifact-only test: every Docker invocation is intercepted; no daemon or deployment.
set -euo pipefail
fixture="$(mktemp -d /tmp/eventos-media-backup-test.XXXXXX)"
[[ "$fixture" == /tmp/eventos-media-backup-test.* ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
mkdir "$fixture/bin" "$fixture/backups" "$fixture/source"
printf 'synthetic media' > "$fixture/source/object"
tar -czf "$fixture/media.tar.gz" -C "$fixture/source" .
export EVENTOS_BACKUP_FIXTURE="$fixture"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$EVENTOS_BACKUP_FIXTURE/calls"
case "$*" in
  'inspect --format '* ) printf '%s\n' "${EVENTOS_BACKUP_VOLUME:-eventos-production_media}" ;;
  'compose --project-name eventos-production '* )
    case "$*" in
      *'exec -T postgres '*pg_dump*) printf 'synthetic database dump' ;;
      *'exec -T postgres pg_restore --list'*) : ;;
      *'exec -T postgres '*psql*) : ;;
      *'exec -T app sh -c '*MEDIA_STORAGE_DRIVER*) printf local ;;
      *'ps -q app') printf 'aaaaaaaaaaaa\n' ;;
      *'exec -T app node --conditions=react-server --import=tsx scripts/backup-local-media.ts')
        [[ "${EVENTOS_BACKUP_FAIL_MEDIA:-0}" == 0 ]] || exit 1
        cat "$EVENTOS_BACKUP_FIXTURE/media.tar.gz" ;;
      *) exit 98 ;;
    esac ;;
  *) exit 99 ;;
esac
MOCK
chmod 700 "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
release="$(pwd)"
bash deployment/windows-iis/backup.sh "$release" "$fixture/backups" > "$fixture/output"
grep -q 'EventOS media backup bytes:' "$fixture/output"
run="$(find "$fixture/backups" -mindepth 1 -maxdepth 1 -type d)"
[[ -s "$run/media.tar.gz" && -s "$run/SHA256SUMS" ]]
(cd "$run" && sha256sum -c SHA256SUMS > /dev/null)
first_checksum="$(sha256sum "$run/media.tar.gz")"
bash deployment/windows-iis/backup.sh "$release" "$fixture/backups" > /dev/null
[[ "$(sha256sum "$run/media.tar.gz")" == "$first_checksum" ]]
[[ "$(find "$fixture/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)" == 2 ]]
if EVENTOS_BACKUP_VOLUME=pricepilot-production_media bash deployment/windows-iis/backup.sh "$release" "$fixture/backups" > /dev/null 2>&1; then exit 1; fi
if EVENTOS_BACKUP_FAIL_MEDIA=1 bash deployment/windows-iis/backup.sh "$release" "$fixture/backups" > /dev/null 2>&1; then exit 1; fi
if grep -Eq 'volume (ls|rm|prune)|system prune' "$fixture/calls"; then exit 1; fi
printf 'PASS: media included and checksummed; no overwrite; wrong volume and archive failure rejected; Docker fully mocked.\n'
