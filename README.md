# AI Notetaker

A local-first notetaker for lectures: record or upload audio, transcribe it locally with Whisper, summarize it into structured notes with a free OpenRouter model, and study with a Feynman-style learning guide (flashcards with spaced repetition, plus a self-test quiz). Organize pages into folders/tags and search across everything.

It also has a **live assistant** for use *during* a lecture: while you record, a rolling transcript appears in real time, an "Explain this" button catches you up on whatever's being discussed right now, and every page has an **Ask AI** chat tab grounded in that lecture's transcript and notes.

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

   Edit `.env` and set `OPENROUTER_API_KEY` to your key from [openrouter.ai/keys](https://openrouter.ai/keys). The default models (`OPENROUTER_MODEL_SUMMARY`, `OPENROUTER_MODEL_FLASHCARDS`, `OPENROUTER_MODEL_QUIZ`, `OPENROUTER_MODEL_CHAT`) point at a free Llama model — OpenRouter's free-tier roster changes over time, so double-check `https://openrouter.ai/models?order=top-weekly` filtered to `:free` and swap in whatever's current if the default stops working.

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
6. Study via **Review** (spaced-repetition flashcard session, SM-2 scheduling) or the page's **Quiz** tab (self-test with instant grading), or open the **Chat** tab to ask the assistant anything about the lecture.
   - On the **Transcript** tab, pages with audio get a synced player: click any transcript line to jump the audio there, and the line being spoken is highlighted as it plays (with a 1×–2× speed toggle).
   - The **Concept map** tab draws an AI-generated map of the lecture's key concepts and how they relate — hover a concept to spotlight its connections.
7. Organize with folders (sidebar) and tags (page header); **Search** looks across transcripts, notes, and flashcards.
8. **Export** a page to Markdown or PDF from the page header.

**Study tools (in the sidebar):**

- **Ask your library** — one AI assistant across *every* lecture. Ask a question and it full-text-searches your notes/transcripts, answers grounded in the most relevant lectures, and links the pages it drew from as citations.
- **Command palette** — press <kbd>⌘K</kbd> / <kbd>Ctrl-K</kbd> (or the button in the header) to jump to any section or open any page by name, keyboard-only.
- **Focus timer** — an automatic Pomodoro timer: a focus block, then a short break, and a long break after every few sessions, cycling on its own. Durations are configurable, it counts your focus sessions for the day, and it keeps ticking accurately even in a background tab.
- **Feynman coach** — pick a concept and explain it in plain words, by typing or by speaking (your voice is transcribed by the local whisper service). A free OpenRouter model scores how clearly a beginner would understand it and calls out gaps, hidden jargon, and a follow-up question to push you deeper. Paste your notes as optional reference material to have it check accuracy too. Refine and re-score as many times as you like.
- **Planner** — review streaks, cards due, and a 7-day upcoming-review schedule.
- **Dictionary** — a personal dictionary of names, acronyms, and jargon (à la Wispr Flow). Terms are passed to the local whisper model as vocabulary hints so they're transcribed with the right spelling, and the summarizer is told to respect them in your notes. An optional hint per term helps the summarizer know what the term means.
- **Integrations** — connect [MCP](https://modelcontextprotocol.io) servers (configured Claude-Desktop-style in `mcp.config.json`) to organize and sync:
  - **Google Calendar**: see this week's schedule, one-click **create a lecture page per class**, and push "Review flashcards (N due)" study blocks into your real calendar.
  - **Notion**: **Export → Sync to Notion** pushes a page's notes, key terms, action items, flashcards, and transcript to a Notion page; re-syncing updates the same page.
  - See "MCP integrations" below for setup.

**Per-page Actions tab:** once a page is transcribed, the **Actions** tab extracts notetaker-style follow-ups — action items/deadlines, decisions, and open questions — as a checklist you can tick off. Regenerating keeps the checked state of unchanged items.

**Transcript tools** (on the Transcript tab): **Clean up transcript** produces a readable version — filler words removed, self-corrections collapsed ("Thursday, no actually Wednesday" → "Wednesday"), ASR errors fixed — while keeping the raw timestamped version; notes are generated from the cleaned text when it exists. **Detect chapters** divides a long lecture into named topic sections shown as jump-to chips on the synced player. Transcripts also export as **SRT/VTT subtitles**, and the whisper service filters silences with VAD to avoid hallucinated text during pauses.

**Notes Edit Mode** (on the Notes tab, à la FreeFlow): select any text in your notes and give a typed — or spoken, transcribed locally — instruction like "make this shorter" or "turn this into a table". Apply, review, and undo if needed.

**During a live lecture:** while recording, a rolling transcript builds up under the timer (each ~15s of audio is transcribed by the local whisper service as you go), and **Explain this** sends the recent transcript to OpenRouter for a quick plain-language catch-up. This live preview is best-effort and separate from the authoritative transcript, which is produced from the full recording when you hit **Save & transcribe**.

Each pipeline stage (transcribe / summarize / generate guide) is independently retriable — if one fails (e.g. a free model returns malformed output, or you hit a rate limit), the status banner shows the error and a retry button for just that step.

## Optional: fully local summaries with Ollama + Qwen3

By default the AI steps (summarize, flashcards, quiz, chat…) call OpenRouter. You can run them locally instead via [Ollama](https://ollama.com):

```bash
ollama pull qwen3:8b   # ~5.2GB; needs roughly 6-8GB of RAM/VRAM
```

Then in `.env` set either:

- `LLM_PROVIDER="ollama"` — every AI step runs locally, or
- `LLM_PROVIDER_SUMMARY="ollama"` — only summarization + action-item extraction run locally (the common "notes stay private, chat stays on the big cloud model" setup).

`OLLAMA_URL` (default `http://127.0.0.1:11434`) and `OLLAMA_MODEL` (default `qwen3:8b`) are also configurable. Qwen3-8B is the sweet spot for 16GB machines; on smaller machines try `qwen3:4b`. Combined with the local whisper service, `LLM_PROVIDER="ollama"` makes the whole pipeline work offline.

## MCP integrations (Google Calendar + Notion)

The app can act as an MCP client. Copy `mcp.config.example.json` to `mcp.config.json` (gitignored — it holds tokens) and fill in:

- **Notion**: create an internal integration at notion.so/profile/integrations, put its token in `NOTION_TOKEN`, share a parent Notion page with the integration, and set that page's id as `NOTION_PARENT_PAGE_ID` in `.env`. Synced lecture pages are created under it.
- **Google Calendar**: follow [@cocal/google-calendar-mcp's auth guide](https://github.com/nspady/google-calendar-mcp) — create a Google Cloud OAuth *Desktop app* client, save the JSON, and point `GOOGLE_OAUTH_CREDENTIALS` at it. The first connection opens a browser consent screen; tokens refresh automatically afterward. (Publish the OAuth app to Production or refresh tokens expire weekly.)

Then open **Integrations** in the sidebar and hit **Test** on each server (the first connection runs `npx` and can take a few seconds). Servers run locally as child processes; nothing goes through any third-party middleman.

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
