# Lectern Phase 5 — The recall spine

**Goal:** Every way the app asks a student to recall something writes to one ledger on one
scale, and the scheduler reads all of it. Failing a concept in a quiz shortens its
flashcard's interval; a blurt produces cards for exactly what was missed; cram surfaces the
weak and the stale first instead of shuffling blind.

**Architecture:** `ReviewLog` grows into the ledger rather than gaining a sibling table
(§16.2) — `computeStreak` already reads it and a second events table would split that query
for no user-visible gain. `src/lib/recall.ts` holds the pure scale work (`normalizeQuality`,
`applyCalibrationPenalty`, `calibration`, `weightedSample`); `src/lib/recall-log.ts` holds
`writeRecall`, the single writer, and the misconception open/close pass. That split mirrors
`embed-math.ts` / `embeddings.ts`: the arithmetic is testable under `node --test` without
Prisma, the database work is not tested and does not need to be.

Four graders exist today and three of them throw their signal away. This phase does not add
a grader — it reroutes the four that exist through one function, then spends the resulting
ledger on scheduling and cram.

**Spec:** `docs/superpowers/specs/2026-08-28-lectern-course-library-design.md` — §16.2 the
ledger, §16.3 the scale, §16.4 type before reveal, §16.5 blurting, §16.6 misconceptions,
§16.7 confidence, §16.8 adaptive cram, §16.9 testing, §17.6 Phase 5.

## Global constraints

- **The `quality = 0` backfill is the risk of this phase** (§17.7). Existing `ReviewLog`
  rows are streak evidence, not grades. Every read that scores quality filters on
  `reviewedAt >= RECALL_LEDGER_SINCE`, one exported constant. Streak counting ignores
  quality and keeps spanning the whole history. The migration lands alone, and every
  `reviewLog` read is grepped before it is written — there are exactly three today
  (`src/app/planner/page.tsx:14`, `:17`, and the create in
  `src/app/api/review/[cardId]/grade/route.ts:26`).
- Every relation on the ledger is `SetNull`. Deleting a lecture must not erase the evidence
  that the student once knew it.
- No existing flow gains a required step. An empty free-recall box reveals the card exactly
  as today; skipping the confidence control stores null; a grader whose ledger write fails
  still returns its grade to the user.
- `writeRecall` is the only writer. Nothing else touches `db.reviewLog.create` after this
  phase, including the flashcard grade route that does today.
- Suggested grades are suggestions. Pre-highlight a button, never auto-submit.
- Tests are `node --test` + `node:assert/strict` under `src/lib/**/*.test.ts`, relative
  imports with the `.ts` extension, no database, no network.
- Run `npm test`, `npx tsc --noEmit`, and `npm run lint` before each commit.

## Deviations from the spec, and why

**`writeRecall` lives in `recall-log.ts`, not `recall.ts`.** The spec puts it in `recall.ts`
alongside the pure helpers. Splitting it keeps `recall.ts` importable by `node --test` — the
same reason `embed-math.ts` exists next to `embeddings.ts`. `recall.ts` is the scale;
`recall-log.ts` is the ledger.

**`topicId` is written null everywhere in Phase 5.** The column, the relation, and the
`[topicId, reviewedAt]` index all land now, because adding them later is another SQLite table
rebuild. But no grader in this phase knows its topic: a flashcard hangs from a page or a
material, and running the embedding topic matcher on every recall event would put a model
call in the grade path to fill a column nothing reads yet. Phase 6's pretest and recitation
are the first writers that know the topic, and they set it. Rollups in this phase group by
page and material, which is what the graders actually carry.

**Type-before-reveal grades over a second endpoint, not inside `POST grade`.** The
suggestion has to exist *before* the student picks a button, so it cannot ride along on the
grade call. `POST /api/review/[cardId]/suggest` takes the typed text and returns a suggested
quality plus the similarity and which grader produced it. The grade route keeps its shape and
gains two optional fields.

## Tasks

### Task 1 — The ledger and its migration (lands alone)

- `prisma/schema.prisma` — `enum RecallKind { FLASHCARD QUIZ FEYNMAN INTERVIEW BLURT PRETEST }`
  and the `ReviewLog` fields from §16.2: `kind` (default `FLASHCARD`), `quality` (default 0),
  `confidence`, `topicId`, `pageId`, `materialId`, `misconception`, `resolvedAt`, `detail`.
  Back-relations `reviewLogs ReviewLog[]` on `CourseTopic`, `Page`, and `Material`; indexes
  on `[reviewedAt]`, `[topicId, reviewedAt]`, `[pageId, reviewedAt]`.
- Generate with `npx prisma migrate dev --create-only` and read what it emits: SQLite cannot
  `ALTER TABLE ADD FOREIGN KEY`, so this is a table rebuild, and the rebuild must carry the
  existing rows across. Verify against a copy of a real `dev.db` before committing, not after.
- `src/lib/recall.ts` — `export const RECALL_LEDGER_SINCE = new Date("2026-09-08T00:00:00Z")`,
  with the comment saying what reads it and what breaks if a read forgets it.
- Nothing else changes in this commit. The app runs identically on the new schema.

### Task 2 — One scale, one writer

- `src/lib/recall.ts` (pure): `normalizeQuality(kind, raw)` per §16.3's table;
  `applyCalibrationPenalty(result, confidence, quality)` — confident (3) and wrong
  (`quality < 3`) forces `intervalDays = 1`, `repetitions = 0`, everything else passes
  through untouched; `calibration(events)` returning overconfident-wrong and
  underconfident-right rates; `weightedSample(items, weights, n, rng)` with an injectable RNG.
- `src/lib/recall-log.ts`: `writeRecall(event)` — normalizes, writes the row, and runs the
  misconception pass (§16.6): a `quality < 3` event stores the grader's one-line diagnosis;
  a `quality >= 4` event on the same card, page, or material closes every open one for that
  target by setting `resolvedAt`. `PRETEST` events are written and never reach a scheduler —
  the guard is in `writeRecall`, not in each caller, because a caller is what forgets.
- Three failed recalls of one target with an open misconception generate one targeted
  flashcard from the correction text, once.
  `// ponytail: three strikes is a guess; it is a threshold, so it is a knob`
- Tests (`src/lib/recall.test.ts`): every kind's boundaries in `normalizeQuality`; the
  calibration penalty's one firing case and its pass-throughs; `weightedSample`'s
  distribution under a seeded RNG and unseen items landing at the mean weight.

### Task 3 — Rerouting the four graders

- `POST /api/review/[cardId]/grade` — accepts optional `typed` and `confidence`, runs
  `scheduleNextReview` then `applyCalibrationPenalty`, and replaces its direct
  `db.reviewLog.create` with `writeRecall`. This is the only route that already wrote to the
  ledger; it must stop writing directly or the two paths diverge.
- `POST /api/quiz/[questionId]/answer` — writes a `QUIZ` event carrying the question's
  `pageId`/`materialId`, MCQ mapping to 4/0 and short answer to `round(similarity * 5)`.
  A wrong answer stores the question's `explanation` as the misconception; it is already
  generated and thrown away today.
- `POST /api/feynman/evaluate` — the coach is stateless, so `feynmanEvaluateSchema` gains an
  optional `pageId`, `FeynmanCoach` gains the prop, and `src/app/feynman/page.tsx` passes it
  on the `?pageId=` path. Without a page the event still lands, parentless; with one it
  reaches the card scheduler. `gaps[0]` is the misconception.
- `POST /api/interview/[id]/answer` — an `INTERVIEW` event per graded turn, 1-5 identity,
  `session.pageId` as the parent, `improvements[0]` as the misconception.
- All four keep returning exactly what they return today. A ledger write that throws is
  logged and swallowed — a student who answered a question has answered it, whatever the
  bookkeeping did.

### Task 4 — Type before reveal, and confidence

- `POST /api/review/[cardId]/suggest` — `cosine(embed(typed), embed(idealExplanation))` via
  §7's embeddings, falling back to `gradeShortAnswer` when embedding is unavailable at every
  rung. Thresholds `>= 0.80 Easy · >= 0.55 Good · >= 0.35 Hard · else Again`.
  `// ponytail: four hand-picked cosine thresholds; env knobs the first time a real deck argues`
  The threshold mapping is pure and lives in `recall.ts`; only the embedding call is in the route.
- `cosine` gets exported from `embed-math.ts` if it is not already reachable — the suggest
  route must not reimplement it.
- `FlashcardFlip` grows a free-recall textarea above the reveal control, and a three-way
  confidence control (`Guessing / Fairly sure / Certain` → 1/2/3). `ReviewSession` posts the
  typed text on reveal, pre-highlights the suggested button, and sends `typed` and
  `confidence` with the grade. Empty box, no confidence, four buttons: today's flow exactly.
- Tests: threshold boundaries, and the Jaccard fallback path producing a grade of the same
  shape.

### Task 5 — Blurting

- `POST /api/pages/[id]/blurt` — the dump plus the lecture notes to the `REASONING` tier,
  returning `{ covered: [string], missed: [string], wrong: [{ claim, correction }] }`,
  Zod-validated in `validation.ts` like every other model response.
- `src/lib/prompts/blurt.ts` for the prompt, matching the shape of the other prompt modules.
- `missed` and `wrong` become flashcards on that lecture in the *same* `db.$transaction` as
  the `BLURT` event, `sourceTerm` set to the missed point so `FlashcardList` shows where they
  came from. Quality is `round(covered / (covered + missed) * 5)`.
- A "Blurt" entry point on the lecture page beside the existing per-lecture actions.
- Tests: the Zod schema against a malformed response; the coverage ratio at its boundaries.

### Task 6 — Misconceptions and adaptive cram

- The course overview lists open misconceptions (`resolvedAt == null`) for the course,
  grouped by lecture or material — the dashboard from §11 becomes the place study starts.
- `/folders/[id]/cram` keeps the Fisher-Yates shuffle as its cold-start path and gains §16.8's
  weighting once the course has ledger events:
  `1 + 2*(1 - recentQuality/5) + 1*min(daysSinceLastSeen/14, 1) + 1*(openMisconception ? 1 : 0)`.
  The sample is drawn across the whole course and never sorted back into lecture order —
  interleaving is the thing the shuffle was there to protect.
- The planner shows the calibration rates beside the streak. Read-only.

### Task 7 — Verification

- `npm test`, `npx tsc --noEmit`, `npm run lint`.
- Against a copy of a real `dev.db`: pre-migration rows survive, the streak on the planner is
  unchanged, and no pre-migration row is read as a failed recall.
- End to end: fail a quiz question that shares a lecture with a card, then confirm that card's
  `nextReviewAt` moved in; blurt a lecture and confirm the missed points became cards in the
  same write; cram a course with events and confirm the weak items lead.
- Confidently-wrong on a mature card drops it to a one-day interval; the same answer with no
  confidence given does not.

## Out of scope

- Everything in §17 — modes on `InterviewSession`, debate, recitation, pretests. That is
  Phase 6, and `PRETEST` exists in the enum only so the ledger does not need a second
  migration to accept it.
- Renaming the four cosine thresholds into env vars. They are constants with a ponytail
  comment until a real deck argues with them.
- A misconception UI beyond the list: no editing, no manual close. The close is earned by a
  later `quality >= 4`, which is the whole point of it.
- Reading `QuizAttempt` history for anything other than cram weighting. The ledger is the
  ledger; `QuizAttempt` stays the quiz's own record.
