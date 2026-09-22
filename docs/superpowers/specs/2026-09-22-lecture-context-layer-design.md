# Lecture context layer

A recording made on a page that already holds slide or reading text must add to
that text, not replace it. Today it replaces it, silently, and leaves the page in
a state that reads as correct.

## The problem

`MaterialList.makeLecturePage` copies a material's text into `Transcript.rawText`
through `POST /api/pages/from-text`, because the summarize, flashcard and quiz
pipeline already runs on a transcript. The page then has a transcript and no
audio.

`TranscriptTab` offers the recording panel, the upload dropzone and the URL
import whenever `hasAudio` is false. It never asks whether a transcript exists.
So a page full of slide text still invites a recording, and
`POST /api/pages/[id]/transcribe` upserts over it: `rawText` and `segments` are
replaced by the audio.

Three consequences, in order of what they cost:

1. On a page built from a pasted transcript or a dropped `.vtt`, `prisma/dev.db`
   holds the only copy of that text. The recording destroys it.
2. On a page built from a material, the material still holds the text, so the
   loss is recoverable by hand — but the lecture and the deck can never be
   studied as one document, which is the thing the feature is for.
3. The transcribe update writes four fields and leaves `cleanText` and `chapters`
   behind, describing text that is gone. `TranscriptTab` opens on the "Cleaned"
   view whenever `cleanText` exists, so the page shows the old slide text
   labelled as the cleaned version of the new recording, beside chapters whose
   timestamps point into audio they were never derived from. No error is raised
   and nothing looks wrong.

Notes generated from a deck alone carry `> ℹ️ **Added context:**` callouts — the
model's guess at what the lecturer would have said. A recording of that lecturer
is the real answer to exactly that guess.

## What we are building

A page's transcript gains a second layer. `rawText`, `segments` and `cleanText`
describe the audio and only the audio. `contextText` holds the slide or reading
text the lecture was delivered over. Notes are built from both: the deck supplies
the structure, the recording supplies what was actually said.

Cleanup gains two rules: a point restated is cut back to its fullest version, and
worked examples are protected from that cut.

## 1. Data model

One migration, three columns on `Transcript`:

| Column | Type | Meaning |
| --- | --- | --- |
| `contextText` | `String?` | The slide or reading text the audio is layered on. |
| `contextSource` | `String?` | The `modelUsed` value the context arrived with — `import:slides`, `import`, `import:subtitles`. |
| `updatedAt` | `DateTime @updatedAt` | The row has only `createdAt` today; the stale-notes banner needs a real modification time. |

`contextSource` reuses the existing `modelUsed` vocabulary on purpose, so
`SLIDES_TRANSCRIPT_SOURCE` (`src/lib/prompts/summarize.ts`) stays the single place
that names the slides variant.

The layer is a snapshot. Re-importing a deck from onQ does not refresh a page that
copied it — a deliberate cut, see Not building.

`npm run db:migrate` snapshots `prisma/dev.db` before the migration runs.

## 2. Filling the layer

### 2.1 Recording onto imported text

`POST /api/pages/[id]/transcribe`, before writing the audio, reads the existing
transcript. When one exists and its `modelUsed` starts with `import`:

- `rawText` moves to `contextText`
- `modelUsed` moves to `contextSource`
- `cleanText` and `chapters` are cleared — both described the text that just
  became context, and leaving them is consequence 3 above
- `rawText`, `segments`, `language` and `modelUsed` take the audio, as today

When no transcript exists, or the existing one is itself a recording, behaviour is
unchanged: a re-record replaces a recording, which is what a re-record means.

This covers every import source, so the `.vtt` and pasted-text loss closes here
rather than only for decks.

### 2.2 Making a page from a material

Unchanged. The text lands in `rawText` with `modelUsed` of `import:slides` or
`import`, and becomes context the first time a recording arrives, by 2.1. Pages
that already exist migrate themselves the same way. No backfill.

### 2.3 Attaching a deck to a page that was recorded first

New route: `POST /api/pages/[id]/context`, body `{ materialId, replace? }`.

- 404 when the page or the material is missing
- 409 when the material's folder is not the page's folder
- 409 when `contextText` is already set and `replace` is not true
- otherwise copies `material.text` into `contextText`, and `SLIDES` →
  `import:slides`, anything else → `import`, into `contextSource`
- re-runs `upsertSearchIndex`

The UI is a control on the Transcript tab beside the recording panel, reading
"Use a deck as context". When it would replace an existing context, the confirm
names the deck being replaced, per `AGENTS.md`.

## 3. What reads the layer

Flashcards and quizzes read `notes.markdown`, not the transcript
(`generate-flashcards/route.ts:25`, `generate-quiz/route.ts:58`), so they inherit
the merge through the notes and need no change at all.

That leaves four readers.

**Notes (`summarize/route.ts`).** A new prompt pair is chosen when `contextText`
is present. The deck supplies the headings and their order; the transcript
supplies the explanation, the worked examples and the emphasis; an `Added context`
callout survives only where neither the deck nor the lecturer covered a term.
Where `contextSource` is not `import:slides`, the same prompt takes the context as
a reading rather than as a deck. With no `contextText`, the existing two-way choice
in `summarizePromptsFor` is untouched, so a slides-only page behaves exactly as it
does today.

Long lectures: the transcript goes through the existing map step and the context
enters whole at the reduce step. A context over the chunk budget is condensed
first with the existing slides map prompt.

**Chat (`chat/route.ts:40`).** Takes both through one helper,
`lectureText(transcript)`, which joins them under labelled headings and falls back
to whichever exists.

**FTS (`fts.ts`).** `transcriptText` becomes `lectureText(transcript)`, so page
search still finds words that appear only on the slides.

**Embeddings (`embeddings.ts`).** Unchanged: audio only. A material-derived deck
is already indexed as a `MATERIAL` chunk, and indexing it again under the page
would put two copies of one text in a course's top-k. The cost is stated rather
than hidden: recording over a pasted or `.vtt` page drops that imported text out
of semantic search, while it stays on the page and in FTS.

Untouched by design: `SyncedTranscriptPlayer` and `cleanupInput` both index off
`segments`, which continue to describe the audio alone. Keeping the layers apart
is what lets those two keep working without a line of change.

## 4. Stale notes

`NotesTab` shows a banner when notes exist and `notes.updatedAt <
transcript.updatedAt`:

> These notes were written from the slides alone — the recording isn't in them yet.

with a Regenerate button that runs the existing summarize task. Nothing
regenerates on its own: an unasked-for model call is both a cost and a silent
overwrite of notes the user may have edited.

One fix regenerate depends on: `summarize/route.ts:86` sets `previousMarkdown:
null` on every update, so today a regenerate cannot be undone. It must store the
markdown it is replacing, which is what that column is for.

## 5. Cleanup: repeats out, worked examples kept

Two additions to `CLEANUP_SYSTEM_PROMPT`, scoped so they do not contradict the
existing "keep every point, example and detail — never condense" contract.

Added to the cut list:

> The same point made again. A lecturer often says a thing two or three times, or
> recaps a slide just read out. Keep the fullest, clearest version, in the
> speaker's own words, where it was first made. A point restated in new terms,
> with a new example, or at a new level of detail is a new point — keep it.

Added as its own rule in the core behaviour, above the filler rules:

> Worked examples survive whole: every step, every number, every intermediate
> result and the final answer, even where the steps look repetitive. Never
> collapse a derivation into its result, and never merge two runs of the same
> method on different inputs.

## Testing

Logic lives in `src/lib` as pure functions with `node --test` unit tests, which is
where every test in this repo already lives:

- the transcribe decision — given an existing transcript row, which fields move —
  covering the import, recording and absent cases
- `lectureText`, with both layers, context only, and transcript only
- the stale-notes predicate
- the context-attach validation schema, including the cross-folder refusal

Route behaviour is exercised through those functions. Prompt wording has no honest
unit test: the cleanup and merged-notes prompts are verified by running them on a
real lecture and reading the output, and that verification is part of the work,
not an afterthought.

## Not building

- **Deck refresh.** An onQ re-import does not update a page that copied the deck.
  Add a "refresh context from material" action if a re-import ever changes a deck
  someone has already recorded against.
- **Slide-to-timestamp alignment.** Interleaving each slide with the stretch of
  lecture that covered it needs alignment nothing here does.
- **Auto-regenerate.** Section 4 offers; it does not act.
