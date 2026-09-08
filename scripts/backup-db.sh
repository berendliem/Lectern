#!/usr/bin/env bash
# Snapshot the database. Everything the app cannot regenerate — transcripts,
# notes, syllabus topics, review history — lives in one SQLite file, so a
# snapshot is the only thing standing between a bad click and a lost semester.
#
# `VACUUM INTO` rather than `cp`: it takes a consistent snapshot of a database
# that is open and mid-write, which a file copy does not (a copy taken while the
# app is writing can land with a partial page and a stale WAL beside it).
set -euo pipefail

cd "$(dirname "$0")/.."

# DATABASE_URL is "file:./prisma/dev.db"; strip the scheme to get the path.
url="${DATABASE_URL:-}"
if [ -z "$url" ] && [ -f .env ]; then
  url="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
if [ -z "$url" ]; then
  echo "DATABASE_URL is not set and .env has no DATABASE_URL — nothing to back up." >&2
  exit 1
fi

db="${url#file:}"
if [ ! -f "$db" ]; then
  echo "No database at $db yet — nothing to back up (normal before the first setup)."
  exit 0
fi

mkdir -p prisma/backups
stamp="$(date +%Y%m%d-%H%M%S)"
out="prisma/backups/$(basename "$db").$stamp.bak"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$db" "VACUUM INTO '$out'"
else
  echo "sqlite3 is not on PATH; copying the file instead. Stop the app first to be sure it is consistent." >&2
  cp "$db" "$out"
fi

echo "Backed up $db -> $out ($(du -h "$out" | cut -f1))"

# Keep the newest 20: enough to cover a bad week, without the repo growing a
# museum. This prune is the only thing in this script that deletes anything,
# and it only ever touches .bak files in this directory.
if [ "$(ls -1t prisma/backups/*.bak 2>/dev/null | wc -l | tr -d ' ')" -gt 20 ]; then
  ls -1t prisma/backups/*.bak | tail -n +21 | while read -r old; do
    echo "Pruning old backup $old"
    rm -f "$old"
  done
fi
