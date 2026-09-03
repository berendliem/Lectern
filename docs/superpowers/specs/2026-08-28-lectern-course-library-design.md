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

`src/lib/embeddings.ts`, built on OpenRouter's OpenAI-compatible `/embeddings`
endpoint. `OPENROUTER_MODEL_EMBED`, default `openai/text-embedding-3-small`.

- `indexSource({ pageId | materialId })` — splits with the existing
  `splitTextIntoChunks(text, 1200)`, hashes each chunk, embeds only chunks whose
  hash or embedding model changed, and replaces the rows in one transaction.
  Called next to the existing `upsertSearchIndex` at each pipeline stage.
- `searchCourse(folderId, query, k)` — embeds the query, loads that course's
  chunks, scores by cosine, returns top-k with their source.
  `// ponytail: brute-force cosine over one course's chunks; move to sqlite-vec
  if a course ever exceeds ~50k chunks`
- `npm run reindex` backfills existing content and re-embeds after a model change.

Vectors are stored as a `Float32Array` buffer in `Chunk.vector`.

**Degradation:** if the embeddings call fails (no key, rate limit, network),
course ask logs the reason and falls back to the existing FTS `searchPages`
path scoped to the course. Retrieval quality drops; the feature does not break.

## 8. Model tiers

A new tier for work that needs long context and better reasoning:

```
OPENROUTER_MODEL_REASONING → OPENROUTER_MODEL_CHAT → OPENROUTER_MODEL_SUMMARY
                            → meta-llama/llama-3.3-70b-instruct:free
```

Default in `.env.example`: `google/gemini-2.5-flash`.

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

The repo has no tests today. Add `npm test` → `tsx --test`, assert-based, no
framework, no fixtures directory beyond inline sample strings.

Covered, because each is non-trivial logic that fails silently:
- cosine similarity and the hash-diff skip in `embeddings.ts`
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
`Chunk` model; `embeddings.ts`; indexing on write; `reindex` script; the
`REASONING` tier; course ask; the nullable-`pageId` migration and every call
site it touches; material-derived flashcards and quiz; course review; cram
extended to materials.
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

## 14. Risks

- **The nullable-`pageId` migration** is the one change that can break existing
  review and cram flows. Mitigation: grep every `pageId` read before writing the
  migration, and land it alone.
- **Embedding cost and drift.** A large course re-embedding on every save would
  be wasteful; the hash-diff is what prevents it, so its test matters more than
  its size suggests.
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
