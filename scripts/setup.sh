#!/usr/bin/env bash
# One-shot, idempotent setup: safe to re-run any time; each step is skipped
# when it's already done. Called automatically by `npm run dev:all`.
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\033[1;35m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup]\033[0m %s\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v node >/dev/null || { warn "Node.js 20+ is required (https://nodejs.org)"; exit 1; }
command -v python3 >/dev/null || { warn "Python 3.10+ is required"; exit 1; }
command -v ffmpeg >/dev/null || warn "ffmpeg not found — transcription won't work until it's installed (macOS: brew install ffmpeg, Ubuntu: sudo apt install ffmpeg)"

# --- web app -----------------------------------------------------------------
if [ ! -d node_modules ]; then
  say "Installing npm dependencies…"
  npm install
fi

if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from .env.example"
  warn "Add your OpenRouter key to .env (OPENROUTER_API_KEY) — or set LLM_PROVIDER=ollama to run fully local."
fi

say "Applying database migrations…"
npx prisma migrate deploy
if [ ! -d src/generated/prisma ] || [ prisma/schema.prisma -nt src/generated/prisma ]; then
  say "Generating Prisma client…"
  npx prisma generate
fi

# --- whisper service ---------------------------------------------------------
cd whisper-service
if [ ! -d .venv ]; then
  say "Creating whisper-service virtualenv…"
  python3 -m venv .venv
fi
# Re-install only when requirements.txt changed since the last install.
if [ ! -f .venv/.deps-ok ] || [ requirements.txt -nt .venv/.deps-ok ]; then
  say "Installing whisper-service Python dependencies…"
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
  touch .venv/.deps-ok
fi
[ -f .env ] || { cp .env.example .env; say "Created whisper-service/.env"; }
cd ..

say "Setup complete. Start everything with: npm run dev:all"
