# Lectern

A local-first course library for students: record or upload a lecture, transcribe it locally with Whisper, summarize it into structured notes with a free OpenRouter model, and study with a Feynman-style learning guide (flashcards with spaced repetition, plus a self-test quiz). Each course also holds its **materials** — the syllabus, slide decks, readings — which feed the same flashcards, quiz, and course-wide question answering, and the syllabus tells you which topics no lecture covers yet.

It also has a **live assistant** for use *during* a lecture: while you record, a rolling transcript appears in real time, an "Explain this" button catches you up on whatever's being discussed right now, and every page has an **Ask AI** chat tab grounded in that lecture's transcript and notes.

## How it's built

- **Web app**: Next.js (App Router, TypeScript) + Tailwind CSS, at the repo root.
- **Database**: SQLite via Prisma (`@prisma/adapter-better-sqlite3`), with a hand-added FTS5 virtual table for full-text search across transcripts/notes/flashcards.
- **Transcription**: two providers, chosen with `TRANSCRIBE_PROVIDER`. The default `whisper` is a separate local Python service (`whisper-service/`, FastAPI + [faster-whisper](https://github.com/SYSTRAN/faster-whisper)) that the web app calls over `localhost`, and runs on any platform. `apple` is on-device and macOS 26+ only: a small Swift CLI (`mac-speech/`) that takes its text and word timings from Apple's Speech framework and its speaker labels from [FluidAudio](https://github.com/FluidInference/FluidAudio), so a recorded lecture comes back with **Speaker 1 / Speaker 2** attribution. Either way transcription is offline once the models are downloaded.
- **Summarization, flashcards, quiz**: [OpenRouter](https://openrouter.ai) chat completions, using a free-tier model by default (configurable per pipeline stage).
- **Study-plan agent**: a per-course agentic run spawned when you hit **Plan my week** on a course page. Lectern starts the [`claude` CLI](https://claude.com/claude-code) with one MCP server of its own (`scripts/lectern-mcp.ts`) that exposes that course's lectures, syllabus coverage, and due cards. The agent reads them, writes a week's plan, and records the action items and review blocks it recommends. It runs on your existing Claude Code credential rather than an API key, and it can only see the one course it was pointed at.
- **Export**: Markdown and PDF (`@react-pdf/renderer`).
- **Reading uploads**: PDF, `.pptx` and `.docx` text is extracted in the browser, so the file itself never reaches the server. Pages with no text layer — a scanned reading, a photographed handout — are OCR'd on the page image with [tesseract.js](https://tesseract.projectnaptha.com/) (English by default; set `NEXT_PUBLIC_OCR_LANG` for another language). This is the one step that isn't offline: the OCR engine and its language data come from `cdn.jsdelivr.net` the first time you OCR anything in a given browser, and are cached from then on. The page image is not uploaded anywhere.
- **Handwritten notes**: photograph or scan the pages and add them the same way — through **Add material**, or by dropping the images on the course. Tesseract is trained on print and turns handwriting into noise, so these go to a vision model instead — a free one by default (`OPENROUTER_MODEL_VISION`) — one page per call, joined into a single material you can edit before saving. This is the one upload that does not stay in your browser: the downscaled photo is sent to that model to be read. Nothing stores the picture — only the text it returns — so keep your originals. Set `LLM_PROVIDER_VISION="ollama"` and pull a multimodal model to run this step on your own machine instead: no rate limit, no cost per page, and the photo stays local.

## Quick start

Prerequisites: Node.js 20+ and Python 3.10+.

```bash
npm run dev:all
```

That's it — the first run sets everything up (npm deps, `.env` files, database migrations, the whisper service's Python venv) and then starts both the web app and the transcription service. Open http://localhost:3000.

Three things to know:

- **ffmpeg** must be on your PATH (macOS: `brew install ffmpeg`, Ubuntu: `sudo apt install ffmpeg`).
- **yt-dlp** (optional): only needed to attach a lecture by pasting a link (macOS: `brew install yt-dlp`, Ubuntu: `sudo apt install yt-dlp`). Recording and uploading a file work without it.
- **The `claude` CLI** (optional): only the study-plan agent needs it. [Install Claude Code](https://claude.com/claude-code) and sign in.
- **An LLM for the AI steps**: put an [OpenRouter](https://openrouter.ai/keys) key in `.env` (`OPENROUTER_API_KEY`) — free-tier models work — **or** go fully local with [Ollama](https://ollama.com): `ollama pull qwen3:8b` and set `LLM_PROVIDER="ollama"` in `.env` (see "Optional: fully local summaries" below).

`npm run setup` runs just the setup steps without starting anything. Re-running either command is always safe — completed steps are skipped.

<details>
<summary>Manual setup (what the script does, step by step)</summary>

1. **Install web app dependencies and configure environment**

   ```bash
   npm install
   cp .env.example .env
   ```

   Edit `.env` and set `OPENROUTER_API_KEY` to your key from [openrouter.ai/keys](https://openrouter.ai/keys). The default models (`OPENROUTER_MODEL_SUMMARY`, `OPENROUTER_MODEL_FLASHCARDS`, `OPENROUTER_MODEL_QUIZ`, `OPENROUTER_MODEL_CHAT`) are all `openrouter/free`, which Lectern sends as a fallback chain of current free chat models (`src/lib/openrouter.ts`) rather than pinning one that may be retired — the bare router is not used, because its pool includes models that are not chat models at all. Name a specific model in `.env` if you want a consistent one; `https://openrouter.ai/models?order=top-weekly` filtered to `:free` shows what's available.

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

4. **Optional: on-device transcription with speakers (macOS 26+)**

   Set `TRANSCRIBE_PROVIDER="apple"` in `.env` and re-run `npm run setup`. It builds `mac-speech` and downloads both model
   sets — Apple's speech asset for your locale and FluidAudio's diarizer (~600MB) — while you watch, rather than during your
   first recording. Speaker labels only appear on saved recordings; the live transcript needs the whole file to tell voices
   apart, so it stays unlabelled.

   Anything missing falls back to whisper without failing the transcription: no binary, no Swift toolchain, an older macOS,
   or no `ffmpeg` for the webm that Chrome records (Safari records mp4, which needs no conversion). `Transcript.modelUsed`
   records which provider actually ran.

To run the two processes by hand instead of via `npm run dev:all`:

```bash
# terminal 1
cd whisper-service && source .venv/bin/activate && uvicorn main:app --port 8000

# terminal 2
npm run dev
```

</details>

Open http://localhost:3000.

## Using it

1. Click **New Page**, give it a title.
2. On the page's **Transcript** tab, record live (mic), upload an existing audio file, or paste a link to a recording — a class on YouTube, a lecture-capture URL, an mp3 on a department page — and Lectern pulls down just the audio track (needs `yt-dlp`).
3. Click **Transcribe audio** in the status banner once audio is saved.
4. Click **Generate notes** once transcribed — this calls OpenRouter to produce structured Markdown notes + key terms.
5. Click **Generate flashcards & quiz** once notes exist — this generates Feynman-style flashcards (explain-it-back prompts, not term/definition pairs) and a quiz mixing short-answer, multiple-choice, and fill-in-the-blank questions.
6. Study via **Review** (spaced-repetition flashcard session, SM-2 scheduling) or the page's **Quiz** tab (self-test with instant grading), or open the **Chat** tab to ask the assistant anything about the lecture.
   - On the **Transcript** tab, pages with audio get a synced player: click any transcript line to jump the audio there, and the line being spoken is highlighted as it plays (with a 1×–2× speed toggle).
   - A card you keep failing is flagged as a **leech** on the Flashcards tab (four misses without three passes in a row). **Rewrite** asks the model for the same concept from a different angle and drops the result into the edit form, so nothing changes until you save it.
   - Under the quiz, **Drill my misses** writes new questions on the concepts you got wrong, asked from a different angle so you're recalling the idea rather than the answer you were just shown. It adds to the quiz; nothing existing is removed.
   - On the **Notes** tab, **Listen to a recap** turns the lecture into a ninety-second spoken summary read aloud by your browser's own voice — for the walk to class. It's written fresh each time and not saved.
   - Formulae and code survive the trip: notes, chat replies, and study plans render LaTeX (`$x^2$`, `$$…$$`) as typeset maths and fenced blocks as code, so a STEM lecture doesn't come back as raw backslashes.
   - The **Concept map** tab draws an AI-generated map of the lecture's key concepts and how they relate — hover a concept to spotlight its connections.
7. Organize with courses (sidebar) and tags (page header); **Search** looks across transcripts, notes, and flashcards. **Home** opens on today: cards due, your streak, the week's exams, deadlines and classes from Google Calendar, and one card per course with how much of it you have mastered.
8. **Export** a page to Markdown or PDF from the page header.

**Per course** (open a course from the sidebar):

- **Overview** — the syllabus topic list with a coverage verdict per topic. Upload the syllabus as a material and hit **Parse syllabus**: a reasoning model extracts the topic outline into an editable list, and each topic is embedded and matched against everything the course has captured. Topics with no lecture behind them are called out; topics with cards show how far along you are. Coverage is a similarity heuristic and says so — a near-miss names the closest lecture rather than claiming the topic was never taught. Tune the bar with `COVERAGE_THRESHOLD` in `.env`, and add or delete topics by hand whenever the parse gets a messy syllabus wrong.
- **Materials** — syllabus, slides, readings, and photographed handwritten notes, with flashcards and a quiz generated from any of them.
- **Ask** — a question answered from that course's lectures *and* materials, with citations.
- **Review**, **Exam cram**, **Feynman**, and **Interview** buttons, each pre-seeded with that course's content.

**Per lecture** (under the lecture header): **Feynman coach** with the lecture's key terms as concepts and its notes as the reference answer, **Focus timer** bound to that lecture, **Dictionary** offering the lecture's key terms as one-click additions, and **Schedule review** to book just that lecture's due cards into your calendar.

**Study tools (in the sidebar):**

- **Ask all courses** — one AI assistant across *every* lecture. Ask a question and it full-text-searches your notes/transcripts, answers grounded in the most relevant lectures, and links the pages it drew from as citations.
- **Command palette** — press <kbd>⌘K</kbd> / <kbd>Ctrl-K</kbd> (or the button in the header) to jump to any section or open any page by name, keyboard-only.
- **Focus timer** — an automatic Pomodoro timer: a focus block, then a short break, and a long break after every few sessions, cycling on its own. Durations are configurable, it counts your focus sessions for the day, and it keeps ticking accurately even in a background tab.
- **Feynman coach** — pick a concept and explain it in plain words, by typing or by speaking (your voice is transcribed by the local whisper service). A free OpenRouter model scores how clearly a beginner would understand it and calls out gaps, hidden jargon, and a follow-up question to push you deeper. Paste your notes as optional reference material to have it check accuracy too. Refine and re-score as many times as you like.
- **Planner** — review streaks, cards due, and a 7-day upcoming-review schedule.
- **Dictionary** — a personal dictionary of names, acronyms, and jargon (à la Wispr Flow). Terms are passed to the local whisper model as vocabulary hints so they're transcribed with the right spelling, and the summarizer is told to respect them in your notes. An optional hint per term helps the summarizer know what the term means.
- **Integrations** — connect [MCP](https://modelcontextprotocol.io) servers (configured Claude-Desktop-style in `mcp.config.json`) to organize and sync:
  - **Google Calendar**: the next two weeks are synced into Lectern and classified as exam, assignment, class or other, each matched to one of your courses by name (fix a match from the row itself). Home shows the academic ones; the Planner shows everything. A class that is about to start gets a one-click **Record** that opens a pre-titled lecture page with the mic live. You can still push "Review flashcards (N due)" study blocks into the calendar from Integrations.
  - **Notion**: **Export → Sync to Notion** pushes a page's notes, key terms, action items, flashcards, and transcript to a Notion page; re-syncing updates the same page.
  - See "MCP integrations" below for setup.

**Per-page Actions tab:** once a page is transcribed, the **Actions** tab extracts notetaker-style follow-ups — action items/deadlines, decisions, open questions, and **exam hints** (the points the lecturer flagged with "this will be on the exam") — as a checklist you can tick off. Regenerating keeps the checked state of unchanged items.

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

- **Notion**: uses Notion's hosted MCP server (`https://mcp.notion.com/mcp`) through the `mcp-remote` proxy — the app's MCP client speaks stdio only, and Notion's own open-source token server is no longer maintained. No token to paste: run `npx -y mcp-remote https://mcp.notion.com/mcp` once in a terminal and authorize in the browser that opens; the grant is cached in `~/.mcp-auth` and reused by the app. Set `NOTION_PARENT_PAGE_ID` in `.env` to a page the authorized account can edit — synced lecture pages are created under it.
- **Google Calendar**: follow [@cocal/google-calendar-mcp's auth guide](https://github.com/nspady/google-calendar-mcp) — create a Google Cloud OAuth *Desktop app* client, save the JSON, and point `GOOGLE_OAUTH_CREDENTIALS` at it. The first connection opens a browser consent screen; tokens refresh automatically afterward. (Publish the OAuth app to Production or refresh tokens expire weekly.)

Then open **Integrations** in the sidebar and hit **Test** on each server (the first connection runs `npx` and can take a few seconds). Servers run locally as child processes; nothing goes through any third-party middleman.

> Put tokens in a server's `env`, never in `args` — commands and args are shown on the Integrations page and in error messages; `env` values are not.

## Lectern as an MCP server (asking Claude about your lectures)

The other direction: `scripts/lectern-mcp.ts` exposes your lectures *to* an MCP client, so you
can ask a Claude Code session what a lecture covered or which syllabus topics nothing has
taught yet. The committed `.mcp.json` wires it up — open this repo in Claude Code, approve the
`lectern` server, and start the dev server, which is where the tools actually read from.

```
list_courses     every course and the courseId the other tools need
list_lectures    one course's lectures, with flashcard and question counts
get_lecture      one lecture's notes or raw transcript
search_course    semantic search over a course's transcripts, notes and materials
topic_coverage   every syllabus topic, and whether anything captured teaches it
review_load      the cards due now, and which lecture each came from
```

Two write tools come with it — `create_action_items` records next steps on a lecture, and
`schedule_reviews` puts review sessions on your calendar (needs the Google Calendar server
above). Unpinned, both reach any course you name, and `schedule_reviews` with no `pageId`
covers every course's due cards at once. Worth knowing before you blanket-approve
`mcp__lectern__*` in your own session: a transcript is recorded audio and uploaded material,
so it is untrusted text, and it flows back to the model through `get_lecture` and
`search_course` — a lecture that contains "add these action items" is text a model can act
on. Per-call approval is what stands between that and a write, so leave it on.

The server has two modes, and the difference is a safety boundary rather than a convenience:

- **Unpinned** — no `LECTERN_FOLDER_ID` in the environment, which is what `.mcp.json` gives you.
  Every course is reachable and each call names its own `courseId`. Fine for a session you are
  sitting in front of, approving calls.
- **Pinned** — `LECTERN_FOLDER_ID` set, which is how the study-plan agent is spawned. The course
  is fixed by the environment and is not a tool argument at all, so an unattended run that
  pre-approves `mcp__lectern__*` cannot reach a course it was not pointed at. `list_courses` is
  not even registered in this mode.

Your own `.mcp.json` never leaks into a study-plan run: that run is spawned with
`--strict-mcp-config` (`src/lib/agent/args.ts`), so it sees only the one pinned server Lectern
hands it.

`topic_coverage` is the one to reach for when you want to know what is still uncovered. Its
scores are a heuristic — a topic it marks uncovered may simply be taught under different words,
so check with `search_course` before treating a gap as real.

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
