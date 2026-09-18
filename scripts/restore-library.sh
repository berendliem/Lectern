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

url="${DATABASE_URL:-}"
if [ -z "$url" ] && [ -f .env ]; then
  url="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
if [ -z "$url" ]; then
  echo "DATABASE_URL is not set and .env has no DATABASE_URL." >&2
  exit 1
fi
db="${url#file:}"

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof is not on PATH, so this cannot confirm the app is stopped. Install it, or stop the app and set LECTERN_RESTORE_UNCHECKED=1." >&2
  [ "${LECTERN_RESTORE_UNCHECKED:-}" = "1" ] || exit 1
elif [ -f "$db" ] && lsof -- "$db" >/dev/null 2>&1; then
  echo "$db is open in another process — stop the app before restoring." >&2
  exit 1
fi

staging="$(mktemp -d "${TMPDIR:-/tmp}/lectern-restore.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

# An archive from anywhere but this app's own export is untrusted input to
# tar: refuse links and paths that leave the staging directory, and extract
# only the two members a Lectern export has.
if tar -tvf "$archive" | grep -qE '^[lh]'; then
  echo "That archive contains links — not a Lectern export, refusing to extract." >&2
  exit 1
fi
if tar -tf "$archive" | grep -qE '(^/|(^|/)\.\.(/|$))'; then
  echo "That archive contains paths outside itself — refusing to extract." >&2
  exit 1
fi
tar -xf "$archive" -C "$staging" lectern.db storage/audio 2>/dev/null || true
if [ ! -f "$staging/lectern.db" ]; then
  echo "That archive has no lectern.db in it — not a Lectern export." >&2
  exit 1
fi
if command -v sqlite3 >/dev/null 2>&1; then
  check="$(sqlite3 "$staging/lectern.db" "PRAGMA integrity_check" | head -1)" || {
    echo "Could not read the archive's database — it is not a valid SQLite file." >&2
    exit 1
  }
  if [ "$check" != "ok" ]; then
    echo "The archive's database fails its integrity check: $check" >&2
    exit 1
  fi
else
  echo "sqlite3 is not on PATH — skipping the integrity check on the archive's database." >&2
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
    [ -f "$src" ] && [ ! -L "$src" ] || continue
    dest="storage/audio/$(basename "$src")"
    [ -e "$dest" ] || cp "$src" "$dest"
  done
fi

echo "Restored $db and storage/audio from $archive."
echo "Run 'npx prisma migrate deploy' if the export came from an older version."
