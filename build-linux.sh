#!/usr/bin/env bash
# Build the Linux desktop bundle (QtWebEngine window). Mirrors build-windows.ps1.
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-.venv-linux/bin/python}
[ -x "$PY" ] || PY=python3

npm --prefix frontend run build
mkdir -p .cache/packaging releases
"$PY" -c "from backend.version import build_id; from pathlib import Path; Path('.cache/packaging/build-id.txt').write_text(build_id(), encoding='ascii')"
"$PY" -m PyInstaller --noconfirm --distpath releases/linux --workpath .cache/packaging/build-linux desktop/PhotoCollection.spec

package=releases/linux/PhotoCollection
cp README.md LICENSE "$package"/
mkdir -p "$package/docs"
for doc in docs/README.md docs/watercolor-usage.md docs/storage-paths.md; do
  [ -f "$doc" ] && cp "$doc" "$package/docs/"
done

version=$("$PY" -c 'from backend.version import VERSION; print(VERSION)')
archive="releases/PhotoCollection-Linux-${version}-x64.tar.gz"
tar -czf "$archive" -C releases/linux PhotoCollection
(cd releases && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
echo "bundle: $package/PhotoCollection"
echo "archive: $archive"
