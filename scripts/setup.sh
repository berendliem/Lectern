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
command -v ffmpeg >/dev/null || warn "ffmpeg not found — transcription won't work until it's installed, and the on-device provider can't read the webm Chrome records (macOS: brew install ffmpeg, Ubuntu: sudo apt install ffmpeg)"
command -v yt-dlp >/dev/null || warn "yt-dlp not found — pasting a link to a recording won't work until it's installed (macOS: brew install yt-dlp, Ubuntu: sudo apt install yt-dlp). Recording and uploading a file work without it."
command -v claude >/dev/null || warn "The 'claude' CLI is not on your PATH — the course study-plan agent needs it. Install Claude Code and sign in (https://claude.com/claude-code); everything else works without it."

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

# --- on-device transcription (optional) --------------------------------------
# Only built when the user asked for it in .env. The build pulls FluidAudio and
# the prefetch downloads ~600MB of CoreML models, which is a rude surprise for
# someone who is happy on whisper.
transcribe_provider="$(grep -E '^\s*TRANSCRIBE_PROVIDER=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
if [ "$transcribe_provider" = "apple" ]; then
  macos_major="$( [ "$(uname -s)" = "Darwin" ] && sw_vers -productVersion | cut -d. -f1 || echo 0 )"
  if [ "$(uname -s)" != "Darwin" ]; then
    warn "TRANSCRIBE_PROVIDER=apple needs macOS — staying on whisper."
  elif [ "$macos_major" -lt 26 ]; then
    warn "TRANSCRIBE_PROVIDER=apple needs macOS 26+ (this is $(sw_vers -productVersion)) — staying on whisper."
  elif ! command -v swift >/dev/null; then
    warn "TRANSCRIBE_PROVIDER=apple needs the Swift toolchain (xcode-select --install) — staying on whisper."
  else
    binary=mac-speech/.build/release/mac-speech
    if [ ! -x "$binary" ] || [ -n "$(find mac-speech/Sources mac-speech/Package.swift -newer "$binary" 2>/dev/null)" ]; then
      say "Building mac-speech (first build fetches FluidAudio; a few minutes)…"
      (cd mac-speech && swift build -c release)
    fi
    # Idempotent, and the only place the multi-minute first-run model download
    # happens with someone watching it rather than mid-recording.
    say "Checking the on-device speech and diarizer models…"
    "$binary" --prefetch || warn "Model prefetch failed — transcription will fall back to whisper until it succeeds."
  fi
fi

say "Setup complete. Start everything with: npm run dev:all"
