#!/usr/bin/env bash
# Single-command startup: runs setup (fast no-op when already set up), then
# starts the web app and the whisper transcription service together.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/setup.sh

exec npx concurrently -n web,whisper -c blue,green \
  "next dev" \
  "cd whisper-service && .venv/bin/uvicorn main:app --reload --port 8000"
