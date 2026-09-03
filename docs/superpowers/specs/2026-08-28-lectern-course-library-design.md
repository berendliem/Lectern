# Lectern — Course Library Design

Date: 2026-08-28
Status: Approved design, ready for implementation planning

## 1. Context

The app today is lecture-first. `Page` is a lecture; `Folder` is a loose
grouping; every AI feature (Feynman coach, interview, ask, review, focus,
planner, dictionary) lives in one flat sidebar at global scope. The only
course-level feature is `/folders/[id]/cram`.

Study material that is not a recorded lecture — the syllabus, the lecturer's
slide decks, assigned readings, a transcript exported from a Teams meeting —
has nowhere to live except as a fake "lecture" created through the text import.

This design turns the course into the primary unit: a per-course library that
holds lectures *and* materials, knows what the syllabus says the course covers,
and can be reviewed, quizzed, and questioned as a whole. The app is renamed
**Lectern**.

## 2. Goals

- Upload a syllabus, slide decks, and readings to a course; their text feeds
  notes, flashcards, quiz, and course-wide question answering.
- Import transcripts produced elsewhere (Teams Facilitator, Zoom, Otter) with
  their timings and speakers intact.
- Review, cram, and ask at course scope, not just lecture scope.
- See which syllabus topics the captured lectures actually cover.
- Give each existing AI feature an entry point at the level where it has
  context: global, course, or lecture.
- Use a cheap long-context model where reasoning quality matters, without
  making every existing action cost money.
- Transcribe on-device on Apple silicon, with speaker labels, keeping the
  personal dictionary working.

## 3. Non-goals

- Multi-user, auth, or sharing. Single-user local app, unchanged.
- Storing original uploaded files. Text is extracted client-side; the source
  file is not persisted.
- OCR of scanned PDFs or images in slides.
- Speaker diarization for live copilot chunks. Diarization needs the whole
  file, so it runs on saved recordings only.
- Rewriting the visual design. The rebrand is vocabulary, navigation, and name.

## 4. Vocabulary

| UI term | Model | Notes |
|---|---|---|
| Course | `Folder` | Model name unchanged; routes stay `/folders/[id]`. |
| Lecture | `Page` | Model name unchanged. |
| Material | `Material` | New. Syllabus, slides, readings. Course-scoped. |
| Topic | `CourseTopic` | New. Extracted from the syllabus. |

The `Folder` → `Course` rename is UI-only, deliberately. A Prisma rename would
touch every relation and ~15 files for zero user-visible gain, and the
migration risk is not worth the vocabulary tidiness.

## 5. Data model

Additive. No existing column is dropped.

```prisma
enum MaterialKind { SYLLABUS SLIDES READING OTHER }
enum ChunkSource  { LECTURE_TRANSCRIPT LECTURE_NOTES MATERIAL }

model Material {
  id             String       @id @default(cuid())
  folderId       String
  kind           MaterialKind
  title          String
  sourceFileName String?      // provenance only; the file itself is not stored
  text           String       // extracted client-side
  slideCount     Int?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  folder        Folder         @relation(fields: [folderId], references: [id], onDelete: Cascade)
  chunks        Chunk[]
  flashcards    Flashcard[]
  quizQuestions QuizQuestion[]

  @@index([folderId, kind])
}

model CourseTopic {
  id               String   @id @default(cuid())
  folderId         String
  title            String
  week             Int?
  order            Int
  sourceMaterialId String?
  createdAt        DateTime @default(now())

  folder Folder @relation(fields: [folderId], references: [id], onDelete: Cascade)

  @@index([folderId, order])
}

model Chunk {
  id         String      @id @default(cuid())
  source     ChunkSource
  pageId     String?
  materialId String?
  ord        Int
  text       String
  vector     Bytes       // Float32Array buffer
  hash       String      // content hash; skips re-embedding unchanged text
  model      String      // embedding model id, for invalidation on model change
  createdAt  DateTime    @default(now())

  page     Page?     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  material Material? @relation(fields: [materialId], references: [id], onDelete: Cascade)

  @@index([pageId])
  @@index([materialId])
}
```

`Chunk` deliberately has no denormalized `folderId`. Course scoping goes through
the relation (`page: { folderId }` / `material: { folderId }`) so moving a
lecture between courses cannot leave stale rows pointing at the old course.

### 5.1 The one invasive change

Material-derived flashcards and quiz questions have no lecture to hang from.
`Flashcard.pageId` and `QuizQuestion.pageId` become **nullable**, with a new
optional `materialId`:

```prisma
model Flashcard {
  pageId     String?
  materialId String?
  page       Page?     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  material   Material? @relation(fields: [materialId], references: [id], onDelete: Cascade)
  // ...unchanged
}
```

Every read path that assumes a non-null `page` must be found by grep and
handled — the review session card header, the cram page, `/api/review/due`'s
`folderId` filter (which must now match on either relation), the flashcard
list, and the quiz runner. This is the highest-risk change in the design and it
lands in a single migration in Phase 2, not spread across phases.

Without it, an uploaded syllabus or slide deck can never produce a flashcard,
which defeats the point of uploading it.

## 6. Ingestion

All extraction happens in the browser; only text reaches the server. This
matches the existing `extractPdfText` trust model and keeps large binaries off
the local server entirely.

- **PDF** — existing `src/lib/pdf-extract.ts`, unchanged.
- **PPTX** — new `src/lib/pptx-extract.ts`. `fflate` (new dependency, ~8kB)
  unzips the file; text comes from `<a:t>` runs in `ppt/slides/slideN.xml`,
  slides ordered numerically, emitted as `Slide N: …` blocks so retrieval can
  cite a slide number.
- **DOCX** — same `fflate`, `word/document.xml`, `<w:t>` runs. Used for Teams
  transcript exports.

Upload flow: `MaterialUploadButton` on the course page extracts text, then
`POST /api/folders/[id]/materials` with `{ kind, title, sourceFileName, text,
slideCount }`. The route stores the `Material`, then indexes it (§7).

## 7. Retrieval

`src/lib/embeddings.ts`, local-first. Embedding runs on this machine, in the
Next.js Node process, via `@huggingface/transformers` (transformers.js v3) with
`Xenova/all-MiniLM-L6-v2` quantized — mean pooling, normalized, 384 dimensions.
The model is fetched once and cached on disk; no key, no cost, no rate limit, so
a full re-index is free.

Embedding stays server-side rather than in the browser deliberately. Indexing
hangs off server pipeline stages (transcribe, summarize, material upload) next
to the existing `upsertSearchIndex`; a browser-only embedder cannot reach those,
and would need a dirty-flag queue drained on next app open plus a query-vector
round trip for ask. Same local model, none of that machinery.

- `indexSource({ pageId | materialId })` — splits with the existing
  `splitTextIntoChunks(text, 1200)`, hashes each chunk, embeds only chunks whose
  hash or embedding model changed, and replaces the rows in one transaction.
  Called next to the existing `upsertSearchIndex` at each pipeline stage.
- `searchCourse(folderId, query, k = 8)` — embeds the query, loads that course's
  chunks **filtered to the active embedding model**, scores by cosine, returns
  top-k with their source.
  `// ponytail: brute-force cosine over one course's chunks; move to sqlite-vec
  if a course ever exceeds ~50k chunks`
- `npm run reindex` backfills existing content and re-embeds every row whose
  `model` differs from the active one. Required after a provider or model change.

Vectors are stored as a `Float32Array` buffer in `Chunk.vector`.

**Provider chain.** `EMBED_PROVIDER=local|openrouter`, default `local`:

```
local transformers.js → OpenRouter /embeddings (free embed model, if key + model set)
                      → FTS searchPages scoped to the course
```

Each rung logs why it fell through. Whether OpenRouter exposes `/embeddings` at
all, and whether any free embed model exists there, is unverified — a 404 simply
drops to the next rung, so the chain is correct either way.

**The dimension trap.** MiniLM is 384-dim; OpenAI-family embeds are 1536.
Cosine across mixed vectors is silently meaningless. `Chunk.model` is what
prevents it: `searchCourse` scores only chunks whose `model` matches the active
embedder, so vectors written by a different provider are invisible rather than
wrong. A provider flip therefore degrades to "fewer results until reindex",
never to bad results.

**Degradation:** if embedding fails at every rung (model load failure, no key,
network), course ask logs the reason and falls back to the FTS `searchPages`
path scoped to the course. Retrieval quality drops; the feature does not break.

## 8. Model tiers

A new tier for work that needs long context and better reasoning, dispatched by
the existing `LLM_PROVIDER=openrouter|ollama` branch in `src/lib/llm.ts` — no
new dispatch code:

```
OPENROUTER_MODEL_REASONING → OPENROUTER_MODEL_CHAT → OPENROUTER_MODEL_SUMMARY
OLLAMA_MODEL_REASONING     → OLLAMA_MODEL
```

Defaults in `.env.example`: `OPENROUTER_MODEL_REASONING="openrouter/free"`,
`OLLAMA_MODEL_REASONING="qwen3:8b"`. Free on both paths.

Free and local models are context-tight, which is why `searchCourse` defaults to
`k = 8` (~10k characters of context) instead of stuffing a whole course into one
prompt.

Used by: syllabus parsing, course ask, coverage matching. Every existing
per-lecture route keeps its current model and its current cost.

## 9. External transcript import

`src/lib/transcript-import.ts` — pure parsers, no I/O, individually testable.

| Input | Typical source | Parsing |
|---|---|---|
| `.vtt` | Teams Facilitator, Teams meeting transcript | `WEBVTT` cues; speaker from `<v Name>` voice tags or a `Name: ` payload prefix |
| `.srt` | Zoom, players | numbered cues, `,` millisecond separator |
| `.docx` | Teams "Download as Word" | `fflate` → `word/document.xml` → timestamped-text parser |
| `.txt` / paste | Otter, Granola, hand notes | `[00:12:34] Speaker:` and `Speaker  0:12` line forms |

`parseExternalTranscript(filename, content)` sniffs the extension first, then
the content (`WEBVTT` header, presence of `-->`, cue numbering), so a
mislabeled or renamed file still parses.

**Reuses the existing route.** `createPageFromTextSchema` gains optional
`segments` and `source`; `/api/pages/from-text` writes real segments instead of
`"[]"` and records `modelUsed: "import:teams"` for provenance. No new endpoint.

**Two additive changes:**
- `TranscriptSegment` gains `speaker?: string`. `rawText` is assembled as
  `Speaker: text` lines so summarize, flashcards, and quiz get attribution for
  free.
- `TranscriptTab` must render segments when `audioFilePath` is null, falling
  back to plain `TranscriptView` instead of the synced player.

**Why segments and not flat text:** chapters (needs ≥4 segments), subtitle
export, and timestamped navigation all work immediately on an imported Teams
meeting. A flat-text import gets none of them.

**Deliberate corner:** consecutive cues from the same speaker within ~15s merge
into one segment, keeping the original span's start and end. Teams emits
one-line cues; unmerged, summaries and flashcards are built from fragments.
`// ponytail: 15s same-speaker merge window; env knob if a lecturer's cadence
fights it`

This merge lives in an exported `mergeSameSpeaker(segments, windowSec)` helper
rather than inline in the parser, because Phase 4's diarization alignment
(§10.2) needs exactly the same grouping. Imported and recorded transcripts must
segment identically or the notes pipeline behaves differently depending on
where the audio came from.

## 10. Transcription provider

Mirrors the existing `LLM_PROVIDER=openrouter|ollama` pattern:
`TRANSCRIBE_PROVIDER=whisper|apple`. `src/lib/transcribe.ts` dispatches;
`src/lib/whisper-client.ts` is untouched.

The current setup runs `faster-whisper` at size `small` on **CPU with int8** —
CTranslate2 has no Metal backend, so Apple silicon sits idle.

The `apple` provider is a **hybrid**: Apple's Speech framework produces the
text, FluidAudio produces the speaker spans, and the two are aligned.

### 10.1 Why both

| | Apple `SpeechAnalyzer` | FluidAudio |
|---|---|---|
| Engine | OS model behind Notes / Voice Memos | Parakeet TDT v3, CoreML on the Neural Engine |
| OS floor | macOS 26+ | macOS 14+ |
| Models | OS-managed via `AssetInventory` | downloaded from HuggingFace, ~600MB+ |
| Dictionary hotwords | `contextualStrings` | no bias API |
| Diarization | none | pyannote / sortformer CoreML |

Neither alone is enough. Apple keeps the personal dictionary working and needs
no model management, but cannot tell speakers apart. FluidAudio can, but has no
contextual-bias equivalent, so lecturer names, acronyms, and jargon would lose
the hotword nudge that works today.

Taking text from Apple and speakers from FluidAudio keeps both.

### 10.2 The binary

`mac-speech/` — a Swift CLI built once by `setup.sh` behind a Darwin and
macOS-26 guard, with FluidAudio as its only SPM dependency. It takes an audio
path and hotwords and prints **the exact JSON the Python service already
returns**, so chapters, subtitle export, and the synced player need no changes.

1. Apple `SpeechTranscriber` with
   `attributeOptions: [.audioTimeRange, .transcriptionConfidence]` yields
   per-word timings and confidence, mapping onto the existing
   `words[{ word, start, end, probability }]` shape.
   `AnalysisContext.contextualStrings[.general]` receives the personal
   dictionary hotwords.
2. FluidAudio's diarizer yields `[{ start, end, speakerId }]` spans over the
   same audio.
3. **Alignment:** each word is assigned the speaker whose span contains the
   word's midpoint — midpoint rather than start, so a word straddling a
   handover is attributed to whoever said most of it. Words with no covering
   span inherit the previous word's speaker. Consecutive words sharing a
   speaker are then grouped into segments by the **same `mergeSameSpeaker`
   helper written for §9**, so imported and recorded transcripts segment
   identically.

Speaker labels are anonymous (`Speaker 1`, `Speaker 2`). Since
`TranscriptSegment.speaker` is free text, a rename UI is a later, trivial
addition and is not in scope.

If the binary is missing, the OS is too old, or either model stack fails to
load, the dispatcher falls back to the whisper provider automatically. If
diarization alone fails, transcription still returns — every segment simply
carries no speaker.

### 10.3 Two real corners

- **Audio format.** `SpeechAnalyzer` reads through AVFoundation, which cannot
  open the `webm/opus` Chrome's `MediaRecorder` produces. `m4a`, `mp3`, and
  `wav` are native; webm requires `ffmpeg` on PATH. Safari already records
  `audio/mp4`, so this is Chrome-specific. `setup.sh` must detect a missing
  ffmpeg and say so, rather than letting the first recording fail.
- **First-run downloads.** Two of them: the Apple locale asset via
  `AssetInventory`, and FluidAudio's CoreML models. Both need a visible
  "preparing speech models…" state, not a silent multi-minute hang. Prefetch
  both during `setup.sh` where possible.

Live copilot chunks benefit most: lower latency and nothing leaves the machine.
Diarization runs on saved recordings only — it needs the whole file, so live
chunks stay speaker-less.

## 11. Information architecture

Three tiers. Each AI feature gets an entry point where it has context.

```
GLOBAL    Courses · Ask all courses · Review all · Planner
          Focus · Dictionary · Search · Integrations

COURSE    Overview (syllabus coverage) · Materials · Lectures
          Ask course · Review · Exam cram · Interview · Feynman

LECTURE   Notes · Transcript · Chat · Concept map · Actions
          Flashcards · Quiz · Interview · Feynman · Focus · Schedule review
```

**Course page** becomes tabbed: Overview, Materials, Lectures, plus action
buttons for Ask, Review, and Cram.

**Overview** maps `CourseTopic` rows onto lectures. A topic's title is embedded
and scored against the course's chunks; matches above a threshold count as
covered. The threshold is an env value, not a constant —
`// ponytail: coverage threshold is a heuristic; needs a real knob because
syllabus phrasing and lecture phrasing rarely match cleanly`. Mastery per topic
reuses `src/lib/mastery.ts`.

**Per-lecture entry points**, all pre-seeded rather than blank-slate:
- **Feynman coach** — launched from a lecture with its key terms as concept
  suggestions and its notes auto-filled as the reference answer.
- **Focus timer** — bound to a lecture so the session logs against it and feeds
  the planner streak.
- **Dictionary** — view and add terms scoped to what that lecture introduced.
- **Schedule review** — straight into the calendar integration from the lecture.

**Syllabus parsing** — `POST /api/folders/[id]/parse-syllabus` sends the
syllabus material to the reasoning model, validates the JSON with Zod, and
writes `CourseTopic` rows. Topics are editable by hand afterwards; a messy
syllabus should never leave the course stuck with garbage topics.

## 12. Testing

`npm test` → `tsx --test`, assert-based, no framework, no fixtures directory
beyond inline sample strings. The suite exists as of Phase 1.

Covered, because each is non-trivial logic that fails silently:
- cosine similarity and the hash-diff skip in `embeddings.ts`
- `searchCourse` ignores chunks written by a different embedding model
- the `pageId`/`materialId` exclusive-or guard on flashcards and quiz questions
- `/api/review/due` course filtering across both relations
- course-ask citation formatting, including the `Slide N` case
- `pptx-extract` slide ordering and text joining
- `transcript-import`: Teams VTT with voice tags, Zoom SRT, Teams docx text,
  Otter-style text — asserting segment count, first and last timestamps,
  speaker split, and the same-speaker merge window
- syllabus JSON Zod validation against a deliberately malformed response
- coverage threshold behaviour at the boundary
- `mergeSameSpeaker` at the window boundary, shared by §9 and §10
- diarization alignment: a word straddling a speaker handover is assigned by
  midpoint, and a word covered by no span inherits the previous speaker

## 13. Phases

Each phase is independently shippable and leaves the app working.

**Phase 1 — Course library and ingestion**
`Material` model and migration; `pptx-extract`; `MaterialUploadButton` and the
materials API; `transcript-import` and the `from-text` extension;
`TranscriptSegment.speaker`; `TranscriptTab` audio-less rendering; course page
tabbed shell; vocabulary pass.
*Done when:* a syllabus, a slide deck, and a Teams VTT can be uploaded to a
course, and the Teams import produces chapters and exportable subtitles.

**Phase 2 — Retrieval and course AI**
`Chunk` model; local `embeddings.ts` and its provider chain; indexing on write;
`reindex` script; the `REASONING` tier; course ask as a fourth tab on the course
page (`POST /api/folders/[id]/ask`); the nullable-`pageId` migration and every
call site it touches; per-material flashcard and quiz generation; course review;
cram extended to materials.

Citations name the source and, where the chunk carries a slide prefix, the slide
number. Mapping a transcript chunk back to a timestamp is deferred — it is extra
machinery for a deep link, and lecture-level citation is enough to trust an
answer.

*Done when:* asking a question at course scope cites both a lecture and a slide,
and a flashcard generated from the syllabus appears in that course's review.

**Phase 3 — Syllabus intelligence and rebrand**
`CourseTopic`; syllabus parsing; coverage dashboard; three-tier navigation
shell; per-lecture Feynman, focus, dictionary, and schedule-review entry
points; rename to Lectern.
*Done when:* the course overview shows which syllabus topics have no lecture
behind them.

**Phase 4 — On-device transcription with speakers**
`TRANSCRIBE_PROVIDER`; the `mac-speech` Swift CLI with FluidAudio as its SPM
dependency; Apple text + FluidAudio speaker spans + midpoint alignment;
`setup.sh` build guard and model prefetch; ffmpeg conversion path; first-run
download state.
*Done when:* a two-speaker recording transcribes on-device with word timings,
dictionary hotwords honoured, and per-segment speaker labels — and removing the
binary silently falls back to Whisper while diarization failing alone still
returns a speaker-less transcript.

Phases 5 and 6 (active recall, agent classroom) are specified in Part II,
§17.6.

## 14. Risks

- **The nullable-`pageId` migration** is the one change that can break existing
  review and cram flows. Mitigation: grep every `pageId` read before writing the
  migration, and land it alone.
- **Embedding drift.** Local embedding is free, so cost is no longer the
  concern — wasted time and mixed-model corpora are. The hash-diff prevents
  re-embedding unchanged text and the `model` filter prevents scoring across
  dimensions, so both of their tests matter more than their size suggests.
- **The exclusive-or that SQLite cannot enforce.** A flashcard must hang from
  exactly one of `pageId` or `materialId`; the database cannot express that, so
  a code-level guard plus its test is the only thing standing between the schema
  and an orphaned or double-parented card.
- **Syllabus parsing quality** varies wildly with syllabus formatting. Topics
  are hand-editable for exactly this reason.
- **Coverage matching** is a similarity heuristic and will be wrong sometimes.
  It is presented as a hint, never as a claim that a topic was not taught.
- **`webm` on Chrome** blocks the Apple provider without ffmpeg. Phase 4 must
  detect this at setup time and say so, rather than failing at first recording.
- **Two model stacks in one binary.** The hybrid buys hotwords and speakers at
  the cost of depending on both Apple's asset pipeline and FluidAudio's model
  downloads. The layered fallback — diarization fails alone, or the whole
  provider falls back to Whisper — is what keeps that from becoming a single
  point of failure, so it must be built, not assumed.
- **Diarization accuracy on lecture audio.** Room echo, a roving microphone,
  and overlapping speech all degrade speaker separation. Labels are a
  convenience on top of the transcript, never something the notes pipeline is
  allowed to depend on.

## 15. Open questions

None blocking. Deferred by choice: sqlite-vec for vector search, storing
original uploaded files, cross-course topic linking, and renaming anonymous
diarization labels to real speaker names.

---

# Part II — Active recall and the agent classroom

Added 2026-09-02. Sections 16-17 extend the design above; Phases 5 and 6 in
§17.6 follow Phase 4. Nothing here changes Phases 1-4.

## 16. Active recall

### 16.1 What is already there, and what is missing

The app schedules with SuperMemo 2 (`src/lib/sm2.ts`) and grades quiz answers
locally (`src/lib/grading.ts`). Four separate features already ask the student
to produce an answer from memory:

| Surface | Produces | Where the signal goes today |
|---|---|---|
| Flashcard review | Self-graded Again/Hard/Good/Easy | SM-2 fields on `Flashcard`, `ReviewLog` row |
| Quiz / cram | MCQ correct-or-not, short-answer Jaccard | `QuizAttempt` — read back by nothing |
| Feynman coach | 0-100 explanation score, gaps, jargon | Nowhere. Not persisted at all |
| Interview | 1-5 per answer, strengths, improvements | `InterviewTurn.feedback`, read back by nothing |

So spacing exists, on one channel. Recall exists, on four channels, three of
which are write-only. A student who bombs the same concept in a quiz, a Feynman
attempt, and an interview still sees its flashcard on the interval SM-2 last
computed, because nothing joined those events up.

Two further gaps are in the *shape* of the review, not the plumbing:

- **The flip card never requires an attempt.** Reveal-then-self-grade is the
  weakest form of retrieval practice; the honest failure mode is recognising the
  answer and grading it Good.
- **Everything is post-test.** Nothing asks the student to guess before the
  lecture, and nothing asks them to dump what they remember after it.

§16 fixes the plumbing and the shape. §17 adds the generative surfaces.

### 16.2 The recall ledger

`ReviewLog` already exists, already has a nullable `flashcardId`, and is already
read by exactly one thing: `computeStreak` in `src/lib/planner.ts`. It becomes
the ledger rather than gaining a sibling table — a second events table would
split the streak query in two for no user-visible gain, the same reasoning that
kept `Folder` un-renamed in §4.

```prisma
enum RecallKind { FLASHCARD QUIZ FEYNMAN INTERVIEW BLURT PRETEST }

model ReviewLog {
  id          String     @id @default(cuid())
  flashcardId String?
  reviewedAt  DateTime   @default(now())

  kind          RecallKind @default(FLASHCARD)
  quality       Int        @default(0)   // 0-5, SM-2's scale, for every kind
  confidence    Int?                     // 0-3, pre-reveal, null when not asked
  topicId       String?
  pageId        String?
  materialId    String?
  misconception String?                  // one-line diagnosis on a failed recall
  resolvedAt    DateTime?                // set when a later recall of it succeeds
  detail        String?                  // JSON: the grader's own payload

  flashcard Flashcard?   @relation(fields: [flashcardId], references: [id], onDelete: SetNull)
  topic     CourseTopic? @relation(fields: [topicId], references: [id], onDelete: SetNull)
  page      Page?        @relation(fields: [pageId], references: [id], onDelete: SetNull)
  material  Material?    @relation(fields: [materialId], references: [id], onDelete: SetNull)

  @@index([reviewedAt])
  @@index([topicId, reviewedAt])
  @@index([pageId, reviewedAt])
}
```

Every relation is `SetNull`, not `Cascade`: deleting a lecture must not erase the
evidence that the student once knew it. A ledger that cascades is a ledger that
lies about the streak.

`@default(FLASHCARD)` and `@default(0)` let the migration backfill existing rows
without a data step. Old rows carry `quality = 0`, which is wrong as a grade —
so every read that scores quality filters on `reviewedAt >= <migration date>`,
seeded from a single exported constant. Streak counting ignores quality and
therefore keeps working over the whole history.

`topicId` is set only once `CourseTopic` exists (Phase 3). Before that, and for
anything the topic matcher cannot place, the event still lands with `pageId` or
`materialId` — a null topic degrades the topic rollups, never the card
scheduling.

### 16.3 Normalizing four graders onto one scale

`src/lib/recall.ts`, pure, tested:

```
normalizeQuality(kind, raw) -> 0..5
```

| Kind | Raw | Mapping |
|---|---|---|
| `FLASHCARD` | 0/3/4/5 from the buttons | identity |
| `QUIZ` MCQ | correct / not | 4 / 0 |
| `QUIZ` short answer | Jaccard 0..1 | `round(similarity * 5)` |
| `FEYNMAN` | score 0..100 | `round(score / 20)` |
| `INTERVIEW` | 1..5 | identity — the scales already coincide |
| `BLURT` | covered / (covered + missed) | `round(ratio * 5)` |
| `PRETEST` | correct / not | never scheduled — see below |

Pretest events are recorded and never fed to a scheduler. Grading a student on
material they have not seen yet would push every topic to a one-day interval on
day one; the pretest exists to prime the lecture, not to measure.

`writeRecall(event)` is the single writer. Every grader calls it; nothing writes
`ReviewLog` directly. That is the only thing keeping the four channels
comparable.

### 16.4 Type before reveal

`FlashcardFlip` grows a free-recall textarea above the reveal control. On
reveal, the typed text is scored and a grade is *suggested* — the four buttons
stay, pre-highlighted, always overridable.

Scoring, in order:

1. `cosine(embed(typed), embed(idealExplanation))` via §7's `embeddings.ts`.
2. If embedding is unavailable at every rung, `gradeShortAnswer` from
   `src/lib/grading.ts` — the Jaccard grader the quiz already uses.

```
>= 0.80 Easy · >= 0.55 Good · >= 0.35 Hard · else Again
// ponytail: four hand-picked cosine thresholds; env knobs the first time a
// real deck argues with them
```

Typing is never mandatory. An empty box reveals the card exactly as today. A
review flow that blocks on a textarea is a review flow that gets skipped, and a
skipped review is worth less than a lazy one. The typed text goes into
`detail`, which is what makes the misconception log (§16.6) possible.

### 16.5 Blurting

`POST /api/pages/[id]/blurt` — the student writes everything they remember from
a lecture, unprompted. The reasoning tier receives the dump and the lecture
notes and returns Zod-validated JSON:

```
{ covered: [string], missed: [string], wrong: [{ claim, correction }] }
```

`missed` and `wrong` become flashcards on that lecture in the same transaction
that writes the `BLURT` recall event. Cards born from a blurt carry
`sourceTerm` set to the missed point, so they are visibly distinguishable in
`FlashcardList` from generated ones.

This is the cheapest generative-learning surface in the whole design: one
prompt, one write, no new model, and it produces exactly the cards the student
has already demonstrated they need.

### 16.6 Misconceptions

A failed recall (`quality < 3`) stores the grader's one-line diagnosis in
`misconception`. Nothing new generates it — the Feynman `gaps`, the interview
`improvements`, the blurt `wrong[].correction`, and the quiz `explanation` are
already produced today and thrown away.

An open misconception (`resolvedAt == null`) closes when a later recall of the
same card, topic, or page scores ≥ 4. The course overview lists the open ones.
A misconception open across three failed recalls of the same target gets one
targeted flashcard generated from its correction text, once —
`// ponytail: three strikes is a guess; it is a threshold, so it is a knob`.

### 16.7 Confidence and calibration

Before reveal, an optional three-way confidence control (`Guessing / Fairly sure
/ Certain` → 1/2/3). Skipping it stores null.

Two consequences, both small:

- **Scheduling.** `applyCalibrationPenalty(sm2Result, confidence, quality)` —
  confident (3) and wrong (`quality < 3`) forces `intervalDays = 1` and
  `repetitions = 0` regardless of what SM-2 returned. Confidently wrong is the
  most expensive error state in studying and the one SM-2 cannot see. Every
  other combination passes through untouched.
- **Reporting.** `calibration(events)` returns overconfident-wrong rate and
  underconfident-right rate over a window, shown on the planner beside the
  streak. Read-only; it changes nothing.

### 16.8 Adaptive cram

`/folders/[id]/cram` currently Fisher-Yates shuffles every question in the
course. It keeps the shuffle as its cold-start path and gains weighting once the
ledger has events for the course:

```
weight(item) = 1
             + 2 * (1 - recentQuality/5)         // weak items surface more
             + 1 * min(daysSinceLastSeen/14, 1)  // stale items surface more
             + 1 * (openMisconception ? 1 : 0)
```

`weightedSample(items, weights, n, rng)` is pure and takes an injectable RNG so
the test can assert the distribution instead of hoping. Items never seen carry
the mean weight, so a fresh question is neither buried nor privileged.

Interleaving is preserved deliberately: the sample is drawn across the whole
course and never sorted back into lecture order. Blocking by lecture is the
thing the shuffle was there to prevent, and weighting must not quietly reinstate
it.

### 16.9 Testing (§16)

- `normalizeQuality` at every kind's boundaries
- pretest events are written and never reach the scheduler
- `applyCalibrationPenalty`: confident-and-wrong forces a 1-day interval;
  every other combination is a pass-through
- type-before-reveal threshold boundaries, and the Jaccard fallback when
  embedding is unavailable
- an empty textarea reveals and grades exactly as the current flow
- blurt JSON Zod validation against a malformed response, and the card write
  being in the same transaction as the event
- misconception closes on a later `quality >= 4` for the same target
- `weightedSample` distribution with a seeded RNG; unseen items get mean weight
- streak counting still spans rows written before the migration
  (`quality = 0` backfill must not be read as a failed recall)

## 17. The agent classroom

Borrowed from OpenMAIC (`THU-MAIC/OpenMAIC`): a lesson is generated in two
stages, and it is delivered by *several* agents with different jobs rather than
one assistant. What is not borrowed: whiteboard drawing, TTS, 3D scenes, and
project-based-learning roles. They are the bulk of that project's surface area
and none of them survive contact with a single-user local notetaker.

### 17.1 Modes on the session that already exists

`InterviewSession` already stores an ordered turn list with a question, an
answer, and feedback per turn. Three modes share it:

```prisma
enum InterviewMode { VIVA PROTEGE DEBATE }

model InterviewSession {
  mode    InterviewMode @default(VIVA)
  persona String?       // free text; the agent's brief
  // ...unchanged
}

model InterviewTurn {
  speaker String?  // null = the examiner, "You" = the student, else an agent name
  // ...unchanged
}
```

`VIVA` is today's behaviour on the default, so no existing session changes.

**`PROTEGE`** — the agent is a classmate who half-followed the lecture and asks
the student to explain. The student teaches; the feedback grades the
*explanation*, not the answer, reusing `FEYNMAN_SYSTEM_PROMPT`'s rubric rather
than the interviewer's. Teaching a confused peer is a stronger generative task
than answering an examiner, and it costs one prompt swap.

**`DEBATE`** — two agent personas argue a course concept, grounded in
`searchCourse(folderId, concept)`. Each utterance is one turn with `speaker`
set and `answer` null. The student interjects at any point; their interjection
is a turn with `speaker = "You"` and `answer` set, and the agents must respond
to it on the next round. Judging two plausible arguments is a retrieval task
disguised as a spectator sport, and it surfaces exactly the distinctions notes
gloss over.

Debate costs several completions per exchange. It runs on the `REASONING` tier
(§8), which is free on both providers, and it is capped at six exchanges per
session — `// ponytail: six is a context-window guess for free models, not a
pedagogical one`.

### 17.2 Recitation lessons

Two-stage, like OpenMAIC's outline → scene pipeline, with the scene vocabulary
cut down to what Lectern can actually render:

1. **Outline** — from a `CourseTopic` plus the top chunks for it, the reasoning
   tier returns 4-6 beats.
2. **Scenes** — each beat becomes one of:

| Scene | Renders as | Writes |
|---|---|---|
| `RECALL` | a free-recall prompt | `BLURT`-graded event |
| `EXPLAIN` | a cited notes excerpt, no interaction | nothing |
| `TEACH` | one `PROTEGE` exchange | `INTERVIEW` event |
| `CHECK` | an existing quiz question for the topic | `QUIZ` event |

A lesson always opens on `RECALL` and never opens on `EXPLAIN`. Being asked
first and told second is the whole point; a lesson that leads with the notes is
a page of notes with quizzes stapled on.

**Lessons are not persisted.** The scene list is generated per session and
discarded; only the recall events survive, and those are the part with value.
`// ponytail: ephemeral lessons; add a Lesson table the first time someone asks
to resume one mid-way`

### 17.3 Pretesting

`POST /api/folders/[id]/topics/[topicId]/pretest` returns three prediction
questions built from the topic title and the syllabus text **only** — never
from the lecture, which by definition has not been watched. The student guesses,
the answers are held, and they are revealed alongside the notes once the lecture
is captured.

Written as `PRETEST` events, excluded from scheduling (§16.3). Depends on
`CourseTopic`, so it lands in Phase 6 with the rest of the classroom, not in
Phase 3 with the topics themselves.

### 17.4 Where these live

Extending §11's three tiers:

```
COURSE    ... + Recitation (per topic) · Debate · Calibration
LECTURE   ... + Blurt · Teach it back (PROTEGE)
TOPIC     Pretest (from the coverage dashboard, before the lecture exists)
```

The coverage dashboard from §11 gains a second reading: a topic with no lecture
behind it is a pretest candidate; a topic with a lecture and open misconceptions
is a recitation candidate. The dashboard stops being a report and becomes the
place study starts.

### 17.5 Testing (§17)

- a `VIVA` session created before the migration still runs unchanged on the
  `mode` default
- `PROTEGE` grades with the Feynman rubric, `VIVA` with the interviewer rubric
- debate turn ordering with a student interjection mid-exchange, and the
  six-exchange cap
- outline JSON Zod validation against a malformed response
- a generated lesson never opens on `EXPLAIN`
- pretest questions are built without the lecture in the prompt

### 17.6 Phases

**Phase 5 — The recall spine** (after Phase 4; needs §7 embeddings from Phase 2)
`ReviewLog` extension and migration; `recall.ts` with `normalizeQuality`,
`writeRecall`, `applyCalibrationPenalty`, `calibration`, `weightedSample`; every
existing grader rerouted through `writeRecall`; type-before-reveal; confidence
control; blurting; misconception capture and close; adaptive cram.
*Done when:* failing a concept in a quiz shortens its flashcard's interval, a
blurt produces cards for what was missed, and cram surfaces the weak items
first.

**Phase 6 — The agent classroom** (needs `CourseTopic` from Phase 3)
`InterviewMode` and `persona`; `InterviewTurn.speaker`; protégé mode; debate;
the two-stage recitation generator; pretests; the course and lecture entry
points.
*Done when:* a course topic can be pretested before its lecture exists, taught
back to a confused classmate after it does, and every one of those attempts is
visible in the same ledger that schedules the cards.

### 17.7 Risks

- **The `quality = 0` backfill.** Existing `ReviewLog` rows are streak evidence,
  not grades. Every quality read must be date-filtered from one exported
  constant; miss one and the scheduler concludes the student has failed
  everything they ever reviewed. This is Phase 5's equivalent of the
  nullable-`pageId` migration and gets the same treatment: grep every read
  before writing the migration, land it alone.
- **Four graders, one scale.** `normalizeQuality` is a set of judgement calls
  wearing a table's clothing. If interview scores land systematically harsher
  than flashcard self-grades, every interviewed topic decays faster than it
  should. The mapping is a knob, its test pins the boundaries, and the
  calibration report is what makes a bad mapping visible.
- **Suggested grades become accepted grades.** Pre-highlighting a button is a
  nudge, and a nudge on the wrong side of a threshold is a scheduling error the
  student will not notice. Hence: suggestion only, never auto-submit, and the
  cosine thresholds stay knobs.
- **Debate on a free model.** Multi-agent exchanges are the most
  context-hungry thing in the design, running on the most context-tight tier.
  The six-exchange cap and `k = 8` retrieval are load-bearing, not tidiness.
- **Generated lessons can be shallow.** A four-beat lesson built from eight
  chunks will sometimes restate the notes. It is ephemeral and free to
  regenerate, which is the mitigation — but it means recitation is an offer,
  never the default study path.
- **More surfaces, same student.** Six ways to practise one concept is six ways
  to avoid practising it. Every new surface writes to the ledger specifically so
  the planner can keep pointing at what is due, rather than at what is new.
