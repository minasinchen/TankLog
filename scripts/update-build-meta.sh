#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Neueste Datei im Projekt, ohne .git und ohne build-meta.js selbst.
latest_line="$(find . -type f \
  ! -path './.git/*' \
  ! -path './build-meta.js' \
  -printf '%T@ %p\n' | sort -nr | head -n 1)"

if [[ -z "${latest_line}" ]]; then
  echo "Keine Dateien gefunden."
  exit 1
fi

latest_ts="$(awk '{print $1}' <<<"$latest_line")"
latest_path="$(awk '{print $2}' <<<"$latest_line")"
latest_epoch="${latest_ts%.*}"

yyyy="$(date -d "@$latest_epoch" +%Y)"
mm="$(date -d "@$latest_epoch" +%m)"
dd="$(date -d "@$latest_epoch" +%d)"
doy="$(date -d "@$latest_epoch" +%j)"
hh="$(date -d "@$latest_epoch" +%H)"
mi="$(date -d "@$latest_epoch" +%M)"
iso="$(date -d "@$latest_epoch" +%Y-%m-%dT%H:%M:%S%z)"

build_full="${yyyy}.${mm}.${dd}.${hh}.${mi}"
build_short="${yyyy}.${doy}.${hh}.${mi}"

cat > build-meta.js <<EOF
window.__BUILD_META__ = {
  full: "${build_full}",
  short: "${build_short}",
  date: "${iso}",
  source: "${latest_path#./}"
};
EOF

echo "build-meta.js aktualisiert:"
echo "  full : ${build_full}"
echo "  short: ${build_short}"
echo "  file : ${latest_path#./}"
