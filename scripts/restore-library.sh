#!/usr/bin/env bash
# Restore a library export (the tar from Export on the Integrations page, or
# from GET /api/library/export) into this checkout.
#
# Stop the app first. SQLite cannot have its file swapped under an open
# connection, and a restore that races the app is how the only copy of a
# semester goes bad. The current database is snapshotted to prisma/backups/
# before anything is replaced; audio files are added, never removed.
set -euo pipefail

cd "$(dirname "$0")/.."

archive="${1:-}"
if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "usage: npm run db:restore -- <lectern-YYYYMMDD.tar>" >&2
  exit 1
fi

port="${PORT:-3000}"
if lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is listening on :$port — stop the app before restoring." >&2
  exit 1
fi

url="${DATABASE_URL:-}"
if [ -z "$url" ] && [ -f .env ]; then
  url="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
if [ -z "$url" ]; then
  echo "DATABASE_URL is not set and .env has no DATABASE_URL." >&2
  exit 1
fi
db="${url#file:}"

staging="$(mktemp -d "${TMPDIR:-/tmp}/lectern-restore.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

tar -xf "$archive" -C "$staging"
if [ ! -f "$staging/lectern.db" ]; then
  echo "That archive has no lectern.db in it — not a Lectern export." >&2
  exit 1
fi
if command -v sqlite3 >/dev/null 2>&1; then
  check="$(sqlite3 "$staging/lectern.db" "PRAGMA integrity_check" | head -1)"
  if [ "$check" != "ok" ]; then
    echo "The archive's database fails its integrity check: $check" >&2
    exit 1
  fi
fi

bash scripts/backup-db.sh

mkdir -p "$(dirname "$db")"
cp "$staging/lectern.db" "$db"
rm -f "$db-wal" "$db-shm" "$db-journal"

if [ -d "$staging/storage/audio" ]; then
  mkdir -p storage/audio
  # An existing file with the same name is the same recording (names are
  # random ids); never overwrite what is already here. A loop rather than
  # `cp -n`, which exits non-zero on macOS when it skips anything.
  for src in "$staging/storage/audio/"*; do
    [ -f "$src" ] || continue
    dest="storage/audio/$(basename "$src")"
    [ -e "$dest" ] || cp "$src" "$dest"
  done
fi

echo "Restored $db and storage/audio from $archive."
echo "Run 'npx prisma migrate deploy' if the export came from an older version."
