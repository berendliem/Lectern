# Learn a material: slide-by-slide and section-by-section walkthroughs

**Date:** 2026-09-21
**Branch:** `feat/material-learn-button`
**Status:** Approved design, awaiting spec review

## Goal

A material in a course library is, today, something you generate *from*:
flashcards, a quiz, or a lecture page. Nothing walks you through it. A student
who wants to actually study the lecturer's deck reads it in the preview pane
like a PDF, which is the passive reading the rest of the app exists to replace.

Add a **Learn** button to slide decks and readings in the material list. It
opens a walkthrough: the material broken into steps, one step per slide for a
deck and one per section for a reading, each step showing the material's own
text, an explanation written for that step, and a recall prompt you answer
before moving on. Your position in the walkthrough persists, and what you miss
becomes flashcards on the existing card path.

Learn sits beside the existing "Lecture notes" button rather than replacing it.
They answer different questions: "turn this into a page of notes" and "teach me
this, one piece at a time."

## Decisions

| Question | Decision |
|---|---|
| Step boundaries | Deterministic, in code: SLIDES splits on the `Slide N:` markers; READING splits on headings from one outline call |
| Teaching text | Generated lazily, on first visit to a step, then cached in that step's row |
| Persistence | Steps, the explanation written for each, and the current step index all persist |
| Recall | Answering a step writes one `ReviewLog` (`RecallKind.WALKTHROUGH`) and turns missed points into flashcards |
| Kind tailoring | Same engine, different prompt: a deck's bullets are shorthand to expand, a reading is an argument to follow |
| Regeneration | None in v1. Steps derive from immutable material text, so there is nothing to overwrite |

Rejected: generating every step in one completion and storing it as JSON on the
material (a sixty-slide deck becomes one huge, slow, truncation-prone call, and
you pay for all of it to read three slides); and materialising the walkthrough
as a lecture `Page` (pages carry no step progress and no per-step recall, and
that is what "Lecture notes" already does).

## 1. Data model

Two new models in `prisma/schema.prisma`, one new `RecallKind` value, and a
relation field on `Material`.

```prisma
model Walkthrough {
  id         String   @id @default(cuid())
  materialId String   @unique
  /// Which step the student is on. The whole point of persisting anything.
  stepIndex  Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  material Material          @relation(fields: [materialId], references: [id], onDelete: Cascade)
  steps    WalkthroughStep[]
}

model WalkthroughStep {
  id            String @id @default(cuid())
  walkthroughId String
  ordinal       Int
  /// "Slide 7" for a deck, the section heading for a reading.
  label         String
  /// The material's own text for this step, copied at split time. Never rewritten.
  sourceText    String
  /// Model-written, filled on first visit to this step. Null until then.
  explanation   String?
  /// The question asked before the explanation is revealed. Null until then.
  recallPrompt  String?

  walkthrough Walkthrough @relation(fields: [walkthroughId], references: [id], onDelete: Cascade)

  @@unique([walkthroughId, ordinal])
}
```

`RecallKind` gains `WALKTHROUGH`. `ReviewLog` itself does not change: it already
carries `materialId` with `onDelete: SetNull`, so deleting a material leaves the
evidence that the student once knew it, exactly as `AGENTS.md` requires.

`sourceText` is a copy, not a pointer into `material.text`. Offsets would rot the
moment a material is ever re-extracted, and the copy is what the recall grader
compares against.

### Migration and data safety

The migration is additive — two new tables, one new enum value, no column is
dropped or rewritten. It still runs through `npm run db:migrate`, which snapshots
`prisma/dev.db` into `prisma/backups/` first.

Deleting a material already cascades to its flashcards, quiz questions, and
chunks, and the confirm dialog in `MaterialList.remove` names each of those. It
gains one more clause when a walkthrough exists: the walkthrough and the position
in it are destroyed too. A count in a button label is not a warning; the sentence
is.

## 2. Splitting a material into steps

A pure module, `src/lib/walkthrough.ts`, owns every boundary decision. The routes
call it; it touches neither the database nor the model.

**Slides.** The pptx extractor emits `Slide N: …` blocks — `slideNumberFromChunk`
in `src/lib/citations.ts` already depends on that shape. `splitSlides(text)`
anchors on `/^Slide (\d+):/m` and returns one step per marker, labelled
`Slide N`.

A slide whose text past its `Slide N:` marker is under 120 characters (a title
card, a section divider, a lone image with no alt text) is folded into the
following step rather than becoming a step of its own; its number joins that
step's label, so the deck's numbering still lines up ("Slides 3–4"). A short
final slide folds backwards into the step before it instead. A walkthrough that makes you press Next through "Week 4" is a
walkthrough people stop using.

**Readings.** Prose has no reliable marker, so one cheap outline call returns the
section headings in order. `splitSections(text, headings)` finds each heading in
the text and cuts there, labelling each step with its heading.

**Fallbacks.** A SLIDES material with no `Slide N:` markers (a deck imported as
flat text) takes the reading path. A material whose text is empty or whitespace
never reaches either: the create route returns 422 and the button surfaces the
message, the same way the existing "Lecture notes" button does when there is no
extracted text.

Only SLIDES and READING get the button. A syllabus is a reference document, not
something to be walked through, and OTHER is a grab bag.

## 3. Routes

| Route | Does |
|---|---|
| `POST /api/materials/[id]/walkthrough` | Creates the walkthrough and its steps, or returns the existing one. Idempotent — a second click resumes, it does not rebuild |
| `POST /api/materials/[id]/walkthrough/steps/[stepId]/teach` | Fills `explanation` and `recallPrompt` if they are null, caches them, returns the step |
| `POST /api/materials/[id]/walkthrough/steps/[stepId]/recall` | Grades the typed answer against `sourceText`, writes the recall, creates cards for what was missed, advances `stepIndex` |
| `PATCH /api/materials/[id]/walkthrough` | Moves `stepIndex` for Back, and for skipping a step without answering it |

Every step route validates that the step belongs to the material in the path, so
a step id from one material cannot be taught or graded under another.

`teach` is the only route that is called on plain navigation, and it is a no-op
once a step has been visited. The walkthrough therefore costs one model call per
step actually reached, plus the single outline call for a reading.

### Recall

`recall` follows the shape `src/app/api/pages/[id]/blurt/route.ts` already
established: one `callLLMJSON` grading call, then a `RecallEvent` through
`writeRecall` in `src/lib/recall-log.ts`, then cards for the missed points via
the existing card-creation path with `assertSingleParent`. The event carries
`materialId` and `kind: "WALKTHROUGH"`; quality is normalised by
`normalizeQuality` like every other grader.

Cards born here are marked with a source term ("From a walkthrough") so a deck
shows where a card came from, matching `BLURT_SOURCE_TERM`.

## 4. Prompts

Two prompt modules under `src/lib/prompts/`, following the existing layout: a
system prompt plus a `build…UserPrompt` function.

The teaching prompt takes the step's `sourceText`, the material title, the step
label, and the kind. The kind is the tailoring:

- **Slides** — the bullets on a slide are shorthand for what the lecturer said
  out loud. Explain the thing the bullets stand for, in the deck's running
  context, not a rephrasing of the bullets.
- **Reading** — a section of prose is a move in an argument. Say what this
  section establishes and how it advances what came before.

Each teaching call returns the explanation and exactly one recall prompt for that
step, so the student is asked before being told — the same ordering the lesson
engine enforces with `openOnRecall`.

The reading outline prompt returns headings only, in document order.

## 5. UI

**The button.** `MaterialList` gains a `Learn` button on SLIDES and READING rows,
beside "Lecture notes". It runs under a task key (`material:${id}:walkthrough`)
like every other generator on that row, so a double click makes one walkthrough,
not two, and then navigates to it.

**The walkthrough.** `/materials/[id]/learn` is a server component that loads the
material and its walkthrough and hands them to a client `WalkthroughRunner`.

Each step shows, in order: the step label, the recall prompt with an answer box,
and — after the answer is submitted or the reveal is clicked — the material's own
text for that step and the explanation. Back, Next, and a progress indicator
("Slide 7 of 42") sit at the bottom. Reopening the page lands on `stepIndex`.

Errors are shown in place and are retryable: a failed `teach` leaves the step
untaught, a failed `recall` leaves the answer in the box. Neither advances
`stepIndex`.

## 6. Testing

`src/lib/walkthrough.test.ts`, in the `node:test` style the other `src/lib` tests
use, covers the part with real branching: slide marker splitting, the short-slide
fold, the no-marker fallback to the reading path, and section splitting including
a heading the model returns that does not appear in the text.

The routes are exercised by hand against a real course before the PR, and the PR's
Verification section says what was walked and what the recall wrote.

## Out of scope

Prefetching the next step's teaching call; a regenerate action; walkthroughs for
SYLLABUS and OTHER materials; spoken playback of a step. Prefetching is the first
one worth revisiting, and only once a step's wait is actually annoying.
