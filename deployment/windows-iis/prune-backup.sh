#!/usr/bin/env bash
# Host only. Exactly one DB-authorized archive directory; never media/database volumes.
set -euo pipefail
[[ $# -eq 4 && "$3" == --selected-job && "$4" =~ ^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$ ]] || exit 2
root="$1"; key="$2"
[[ "$root" =~ ^/[A-Za-z0-9_./-]+$ && -d "$root" && ! -L "$root" && "$root" != / ]] || exit 2
canonical_root="$(realpath -e -- "$root")"
[[ "$canonical_root" == "${root%/}" ]] || exit 2
# Caller validates the Windows ACL. Linux roots must have private Unix permissions.
if [[ "$root" == /mnt/[a-z]/* ]]; then
  [[ "${EVENTOS_WINDOWS_BACKUP_ACL_VERIFIED:-0}" == 1 ]] || exit 2
else
  mode="$(stat -c %a -- "$root")"
  (( (8#$mode & 077) == 0 )) || exit 2
fi
uuid='[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}'
[[ "$key" =~ ^eventos-[0-9]{8}T[0-9]{6}Z-$uuid$ || "$key" =~ ^tenant-$uuid-[0-9]{8}T[0-9]{6}Z-$uuid$ ]] || exit 2
target="$canonical_root/$key"
[[ "$target" != "$canonical_root" && ! -L "$target" ]]
# An absent directory is accepted only after the host revalidated durable DB selection
# for this exact job/key; mark-pruned performs the same DB authorization check.
if [[ ! -e "$target" ]]; then echo 'Previously selected backup directory already absent.'; exit 0; fi
[[ -d "$target" && "$(realpath -e -- "$target")" == "$target" && "$(dirname -- "$target")" == "$canonical_root" ]]
[[ -z "$(find "$target" -type l -print -quit)" ]] || exit 2
[[ -f "$target/manifest.json" ]] || exit 2
grep -Fq -- "\"jobId\":\"$4\"" "$target/manifest.json" || exit 2
if [[ "$key" == eventos-* ]]; then
  grep -Fq -- '"scope":"FULL_PLATFORM"' "$target/manifest.json" || exit 2
else
  tenant_id="${key:7:36}"
  grep -Fq -- '"scope":"TENANT"' "$target/manifest.json" || exit 2
  grep -Fq -- "\"tenantId\":\"$tenant_id\"" "$target/manifest.json" || exit 2
fi
rm -rf --one-file-system -- "$target"
[[ ! -e "$target" ]]
echo 'Selected backup directory removed.'
