# AI Notetaker

A local-first notetaker for lectures: record or upload audio, transcribe it locally with Whisper, summarize it into structured notes with a free OpenRouter model, and study with a Feynman-style learning guide (flashcards with spaced repetition, plus a self-test quiz). Organize pages into folders/tags and search across everything.

## How it's built

- **Web app**: Next.js (App Router, TypeScript) + Tailwind CSS, at the repo root.
- **Database**: SQLite via Prisma (`@prisma/adapter-better-sqlite3`), with a hand-added FTS5 virtual table for full-text search across transcripts/notes/flashcards.
- **Transcription**: a separate local Python service (`whisper-service/`, FastAPI + [faster-whisper](https://github.com/SYSTRAN/faster-whisper)) that the web app calls over `localhost`. Runs fully offline once the model is downloaded.
- **Summarization, flashcards, quiz**: [OpenRouter](https://openrouter.ai) chat completions, using a free-tier model by default (configurable per pipeline stage).
- **Export**: Markdown and PDF (`@react-pdf/renderer`).

## Prerequisites

- Node.js 20+
- Python 3.10+
- **ffmpeg** installed on your system (used by faster-whisper to decode audio):
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
- An [OpenRouter](https://openrouter.ai) account and API key (free-tier models exist; you don't need to add credit to use them, but free models have rate limits)

## Setup

1. **Install web app dependencies and configure environment**

   ```bash
   npm install
   cp .env.example .env
   ```

   Edit `.env` and set `OPENROUTER_API_KEY` to your key from [openrouter.ai/keys](https://openrouter.ai/keys). The default models (`OPENROUTER_MODEL_SUMMARY`, `OPENROUTER_MODEL_FLASHCARDS`, `OPENROUTER_MODEL_QUIZ`) point at a free Llama model — OpenRouter's free-tier roster changes over time, so double-check `https://openrouter.ai/models?order=top-weekly` filtered to `:free` and swap in whatever's current if the default stops working.

2. **Initialize the database**

   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

   This creates `prisma/dev.db`, a single local SQLite file. Back it up by copying that file.

   > Note: use `prisma migrate deploy` here, not `prisma migrate dev`. The FTS5 search table creates internal SQLite "shadow" tables that `migrate dev`'s drift detector doesn't recognize, which can trigger a prompt to reset your database. `deploy` just applies migrations and is what you want for normal use. (If you're adding a *new* migration during development, use `prisma migrate dev --create-only` and apply it with `deploy`.)

3. **Set up the whisper transcription service**

   ```bash
   cd whisper-service
   python3 -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   cp .env.example .env
   cd ..
   ```

   The model (`small` by default, ~465MB) downloads automatically from Hugging Face the first time you transcribe something, and is cached afterward. If you're on a low-resource machine, set `WHISPER_MODEL_SIZE=base` (faster, smaller, somewhat less accurate) in `whisper-service/.env`. If you have a GPU, set `WHISPER_DEVICE=cuda`.

## Running it

You need both processes running:

```bash
# terminal 1
cd whisper-service && source .venv/bin/activate && uvicorn main:app --port 8000

# terminal 2
npm run dev
```

Or, as a convenience, from the repo root: `npm run dev:all` (runs both via `concurrently`; you should still have run the whisper-service setup in step 3 above first).

Open http://localhost:3000.

## Using it

1. Click **New Page**, give it a title.
2. On the page's **Transcript** tab, either record live (mic) or upload an existing audio file.
3. Click **Transcribe audio** in the status banner once audio is saved.
4. Click **Generate notes** once transcribed — this calls OpenRouter to produce structured Markdown notes + key terms.
5. Click **Generate flashcards & quiz** once notes exist — this generates Feynman-style flashcards (explain-it-back prompts, not term/definition pairs) and a mixed short-answer/multiple-choice quiz.
6. Study via **Review** (spaced-repetition flashcard session, SM-2 scheduling) or the page's **Quiz** tab (self-test with instant grading).
7. Organize with folders (sidebar) and tags (page header); **Search** looks across transcripts, notes, and flashcards.
8. **Export** a page to Markdown or PDF from the page header.

Each pipeline stage (transcribe / summarize / generate guide) is independently retriable — if one fails (e.g. a free model returns malformed output, or you hit a rate limit), the status banner shows the error and a retry button for just that step.

## Project layout

```
prisma/                 # schema, migrations (incl. hand-written FTS5 table)
src/app/                # Next.js routes (pages + API routes)
src/components/         # React components, grouped by feature
src/lib/                # DB client, OpenRouter/whisper clients, SM-2, grading, prompts
storage/audio/           # recorded/uploaded audio files (gitignored)
whisper-service/         # Python FastAPI + faster-whisper sidecar
```

## Troubleshooting

- **"Could not reach the whisper service"**: make sure `uvicorn` is running on port 8000 (or update `WHISPER_SERVICE_URL` in `.env`).
- **"OPENROUTER_API_KEY is not set"**: copy `.env.example` to `.env` and add your key.
- **Model returned invalid JSON / didn't match the expected format**: happens occasionally with smaller free models. Just hit Retry on that pipeline stage, or switch `OPENROUTER_MODEL_*` to a different free model.
- **First transcription is slow**: that's the one-time model download; subsequent runs are fast.
