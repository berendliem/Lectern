# Design plan: Wispr-Flow-inspired features + local Qwen3 summaries

## Background research

**Wispr Flow** is a voice-dictation product whose signature features are: cleanup of
filler words / punctuation, tone adaptation per app, voice command mode ("make this
more concise"), 100+ languages, and — crucially — a **personal dictionary** of names,
acronyms and jargon that the speech model learns to spell correctly.

**Wispr Flow Notetaker** (launched Aug 2026) is their meeting notetaker. It captures
system audio on-device instead of joining calls as a bot, shows a live transcript, and
after the meeting produces notes covering **decisions, deadlines, assigned work, and
unresolved issues**. It reuses the personal dictionary from dictation so jargon is
transcribed correctly, and lets you query past meetings.

**Where this app already overlaps:** live rolling transcript while recording,
"Explain this" catch-up, per-page Ask-AI chat, cross-library Q&A with citations,
structured summaries. **What it lacks** (and what we adopt):

1. A **personal dictionary** that biases transcription and summarization.
2. **Action items / decisions / open questions** extraction from a lecture.
3. A **local summarization model** — today every AI step requires OpenRouter (cloud).

## Current voice model

Transcription is fully local already: `whisper-service/` wraps
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) running **Whisper `small`**
(default; configurable `tiny`–`medium` via `WHISPER_MODEL_SIZE`, CPU int8 by default,
CUDA optional). Summaries/flashcards/quiz/chat use OpenRouter free-tier models
(default `meta-llama/llama-3.3-70b-instruct:free`).

## Feature 1 — Local summaries with Qwen3-8B via Ollama

Qwen3-8B (`qwen3:8b` in Ollama, ~5.2 GB at Q4_K_M) runs comfortably on a 16 GB
machine (~6–8 GB memory; ~40 tok/s on a mid GPU, slower on CPU) and is strong at
structured JSON summarization. Design:

- New `src/lib/llm.ts` provider layer exposing `callLLMText` / `callLLMJSON` with the
  same signatures the OpenRouter helpers have today, plus an optional `stage` hint.
- Providers: `openrouter` (existing behavior, default) and `ollama`.
  - `LLM_PROVIDER` selects the global default provider.
  - `LLM_PROVIDER_SUMMARY` optionally overrides just the summarize stage — the
    common setup "local summaries, cloud for everything else".
- New `src/lib/ollama.ts`: POST `{OLLAMA_URL:-http://127.0.0.1:11434}/api/chat`
  with `stream: false`, `think: false` (Qwen3 supports disabling thinking mode),
  `format: "json"` when JSON is required, model from `OLLAMA_MODEL` (default
  `qwen3:8b`). Defensively strip `<think>…</think>` blocks from output.
- All existing OpenRouter call sites switch their import to `llm.ts`; `modelUsed`
  records `ollama:qwen3:8b` style identifiers when local.

## Feature 2 — Personal dictionary (Wispr Flow's signature)

- Prisma model `DictionaryTerm { id, term (unique), hint?, createdAt }` where `hint`
  is an optional gloss ("EBITDA — earnings measure") that helps the summarizer.
- faster-whisper natively supports vocabulary biasing: pass the joined terms as
  `hotwords` to `model.transcribe()`. `whisper-service` accepts an optional
  `hotwords` form field; the Next.js `whisper-client` sends it. All transcription
  entry points (full transcribe, live-transcribe, copilot chunks, Feynman voice,
  interview answers) load the dictionary and pass it.
- The summarize prompt gets a "respect these spellings" section built from the
  dictionary, so notes keep jargon/names right too.
- UI: a **Dictionary** page (sidebar link) to add/remove terms; server component +
  small client list, matching existing UI idioms.
- API: `GET/POST /api/dictionary`, `DELETE /api/dictionary/[id]`. Term capped at
  64 chars, hint at 200; total sent to whisper capped (first ~50 terms) to keep the
  hotwords prompt small.

## Feature 3 — Action items & decisions (Notetaker-style)

- Prisma model `ActionItem { id, pageId, kind, text, done, createdAt }` with
  `kind ∈ ACTION | DECISION | QUESTION` (assigned work / decisions & deadlines /
  unresolved issues — mirroring Wispr Notetaker's note structure).
- New prompt `src/lib/prompts/action-items.ts` returning
  `{ items: [{kind, text}] }`; explicit "return empty array if none — lectures often
  have none" so purely expository lectures don't get hallucinated tasks.
- API: `POST /api/pages/[id]/action-items` regenerates (delete + insert, preserving
  `done` for identical text), `GET` lists; `PATCH /api/action-items/[id]` toggles
  `done`.
- UI: new **Actions** tab on the page detail view — checklist grouped by kind, with
  a Generate/Regenerate button; enabled once a transcript exists.

## Out of scope (deliberately)

- System-audio capture without joining calls (browser can't; needs a native app).
- Speaker diarization (faster-whisper alone doesn't do it well).
- Voice command mode for editing notes (large surface; revisit later).

## Rollout / migration

One hand-written SQL migration (matching the existing FTS5-era convention: create
via `migrate dev --create-only` style file, applied with `prisma migrate deploy`)
adds `DictionaryTerm` and `ActionItem`. `.env.example` gains
`LLM_PROVIDER`, `LLM_PROVIDER_SUMMARY`, `OLLAMA_URL`, `OLLAMA_MODEL`. README gains an
"Optional: local summaries with Ollama/Qwen3" section. No breaking changes: with no
new env vars set, behavior is identical to today.

## Review plan

After implementation: `npm run lint` + `npx tsc --noEmit`, then a code review and a
security review run by subagents (Sonnet + Opus reviewers, Haiku sanity pass), fixes
applied, findings documented in the PR-ready commit history.
