# Material Walkthroughs ("Learn") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give slide decks and readings in a course library a **Learn** button that opens a persisted, step-by-step walkthrough — one step per slide, one per section — where each step teaches, asks for recall, and feeds what was missed into the existing flashcard and recall-ledger machinery.

**Architecture:** Step boundaries are computed in code from the material's own text (`Slide N:` markers for decks, model-supplied headings for readings) and stored as `WalkthroughStep` rows. Each step's explanation and recall prompt are generated on first visit and cached in the row, so a sixty-slide deck costs one model call per slide actually reached. Position lives in `Walkthrough.stepIndex` and survives a refresh. Grading reuses `writeRecall`/`recallRow` and the existing card-creation path — no new ledger writer.

**Tech Stack:** Next.js 15 App Router (server components + route handlers), React 19 client components, Prisma 7 on SQLite (`prisma/dev.db`), Zod validation, `node:test` via `npm test`, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-21-material-walkthrough-design.md`

## Global Constraints

- **`main` is protected.** Work stays on `feat/material-learn-button`; the change reaches `main` through a pull request. See `AGENTS.md`.
- **Do not start, stop, or restart the dev server.** The user runs it themselves. Verification in this plan is `npm test`, `npx tsc --noEmit`, and `npm run lint` only.
- **Migrations are hand-authored.** `prisma migrate dev` proposes dropping the `page_search` FTS5 virtual tables, which the Prisma datamodel cannot see. Write `migration.sql` by hand and apply it with `npm run db:migrate`, which snapshots `prisma/dev.db` into `prisma/backups/` first.
- **`ReviewLog` never cascades.** Every relation on it is `SetNull` on purpose. This feature adds no relation to it.
- **Every destructive action names what it destroys, before it happens.** The material delete confirm gains a clause for walkthrough progress.
- **`RecallKind` is stored as TEXT on SQLite.** Adding an enum value needs a schema change and `prisma generate`, but no SQL.
- **The generated Prisma client is git-ignored** (`.gitignore:53`, since `b0a279b`). Run `npx prisma generate` after a schema change, but commit nothing from `src/generated/prisma`.
- **Commit style:** `<type>: <imperative phrase>`, lowercase, one logical change per commit. End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | `Walkthrough`, `WalkthroughStep`, `Material.walkthrough`, `RecallKind.WALKTHROUGH` |
| `prisma/migrations/20260921120000_material_walkthrough/migration.sql` (create) | The two additive tables and their indexes |
| `src/lib/recall.ts` (modify) | `RecallRaw` variant + quality mapping for a walked step |
| `src/lib/walkthrough.ts` (create) | Pure splitting: `splitSlides`, `splitSections`, seed and view types. No DB, no model |
| `src/lib/walkthrough.test.ts` (create) | Tests for every branch in the splitters and the schemas |
| `src/lib/prompts/walkthrough.ts` (create) | Outline, teaching and marking prompts, kind-tailored |
| `src/lib/validation.ts` (modify) | Request and model-response schemas for the three routes |
| `src/app/api/materials/[id]/walkthrough/route.ts` (create) | POST create-or-return, PATCH step index |
| `src/app/api/materials/[id]/walkthrough/steps/[stepId]/teach/route.ts` (create) | Fill and cache one step's explanation + recall prompt |
| `src/app/api/materials/[id]/walkthrough/steps/[stepId]/recall/route.ts` (create) | Grade an answer, write the recall, make cards, advance |
| `src/app/materials/[id]/learn/page.tsx` (create) | Server component: load material + steps, render the runner |
| `src/components/walkthrough/WalkthroughRunner.tsx` (create) | The client step machine |
| `src/components/dashboard/MaterialList.tsx` (modify) | The Learn button and the delete-confirm clause |

---

### Task 1: Schema, migration, and the recall scale

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260921120000_material_walkthrough/migration.sql`
- Modify: `src/lib/recall.ts:38-47` (`RecallRaw`), `src/lib/recall.ts:60-93` (`normalizeQuality`)
- Test: `src/lib/recall.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `Walkthrough { id, materialId, stepIndex, createdAt, updatedAt, steps }` and `WalkthroughStep { id, walkthroughId, ordinal, label, sourceText, explanation, recallPrompt }`; the `RecallRaw` variant `{ kind: "WALKTHROUGH"; covered: number; missed: number; wrong: number }`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/recall.test.ts`:

```ts
test("normalizeQuality scores a walked step the way it scores a blurt", () => {
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 0, missed: 3, wrong: 0 }), 0);
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 2, missed: 2, wrong: 0 }), 3);
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 4, missed: 0, wrong: 0 }), 5);
  // Nothing to score against is a 0, not a division by zero.
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 0, missed: 0, wrong: 0 }), 0);
  // A wrong claim sits in the denominator beside what was missed.
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 4, missed: 0, wrong: 4 }), 3);
});

test("a walked step is schedulable", () => {
  assert.equal(isSchedulable("WALKTHROUGH"), true);
});
```

If `isSchedulable` is not already imported at the top of that file, add it to the existing import from `./recall.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — TypeScript rejects `kind: "WALKTHROUGH"` as not assignable to `RecallRaw`.

- [ ] **Step 3: Add the enum value and the two models to the schema**

In `prisma/schema.prisma`, add `WALKTHROUGH` to `RecallKind` (after `PRETEST`):

```prisma
enum RecallKind {
  FLASHCARD
  QUIZ
  FEYNMAN
  INTERVIEW
  BLURT
  PRETEST
  WALKTHROUGH
}
```

Add the relation field to `model Material`, beside `chunks` and `flashcards`:

```prisma
  walkthrough   Walkthrough?
```

Add the two models at the end of the file:

```prisma
/// A material walked one step at a time: one step per slide for a deck, one per
/// section for a reading. Steps are derived from the material's text and never
/// rewritten, so there is nothing here to overwrite and no regenerate action.
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
  /// "Slide 7" or "Slides 3-4" for a deck, the section heading for a reading.
  label         String
  /// The material's own text for this step, copied at split time. A character
  /// offset into Material.text would rot the moment a file is re-extracted, and
  /// this copy is what the recall grader marks the student's answer against.
  sourceText    String
  /// Model-written, filled on first visit to this step. Null until then.
  explanation   String?
  /// Asked before the explanation is revealed. Null until then.
  recallPrompt  String?

  walkthrough Walkthrough @relation(fields: [walkthroughId], references: [id], onDelete: Cascade)

  @@unique([walkthroughId, ordinal])
}
```

- [ ] **Step 4: Write the migration by hand**

Create `prisma/migrations/20260921120000_material_walkthrough/migration.sql`:

```sql
-- CreateTable
--
-- Hand-authored rather than `prisma migrate dev`: this repo's `page_search`
-- FTS5 virtual tables are invisible to the Prisma datamodel, so the diff
-- engine always proposes dropping them alongside any real change (see
-- 20260911180000_calendar_events for the same note). Additive only — two new
-- tables and their indexes, no column dropped or rewritten.
--
-- RecallKind gains WALKTHROUGH in the datamodel only: Prisma stores enums as
-- TEXT on SQLite, so there is no type to alter here.
CREATE TABLE "Walkthrough" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Walkthrough_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Walkthrough_materialId_key" ON "Walkthrough"("materialId");

-- CreateTable
CREATE TABLE "WalkthroughStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walkthroughId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "explanation" TEXT,
    "recallPrompt" TEXT,
    CONSTRAINT "WalkthroughStep_walkthroughId_fkey" FOREIGN KEY ("walkthroughId") REFERENCES "Walkthrough" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WalkthroughStep_walkthroughId_ordinal_key" ON "WalkthroughStep"("walkthroughId", "ordinal");
```

- [ ] **Step 5: Extend the recall scale**

In `src/lib/recall.ts`, add the variant to the `RecallRaw` union, after the `BLURT` line:

```ts
  /** One step of a material walkthrough, marked the way a blurt is. */
  | { kind: "WALKTHROUGH"; covered: number; missed: number; wrong: number }
```

and fold it into the existing `BLURT` case in `normalizeQuality`, so the two share one mapping rather than drifting apart:

```ts
    case "BLURT":
    case "WALKTHROUGH": {
      // Wrong claims sit in the denominator beside what was missed. The spec
      // scored covered/(covered+missed), which hands a perfect 5 to a dump that
      // recalled everything and also asserted eight things the notes contradict
      // — and a 5 closes every open misconception on that lecture.
      const asked = raw.covered + raw.missed + raw.wrong;
      // Nothing to score against is not a failure; an empty answer scores 0 on
      // its own because `covered` is 0.
      return asked === 0 ? 0 : clamp((raw.covered / asked) * 5);
    }
```

- [ ] **Step 6: Apply the migration and regenerate the client**

Run: `npm run db:migrate`
Expected: the backup script prints a snapshot path under `prisma/backups/`, then `prisma migrate deploy` reports one migration applied.

Run: `npx prisma generate`
Expected: writes `src/generated/prisma` with the two new models.

- [ ] **Step 7: Run the tests and the type-check**

Run: `npm test`
Expected: PASS, including the two new recall tests.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260921120000_material_walkthrough src/lib/recall.ts src/lib/recall.test.ts
git commit -m "feat: walkthrough tables and a recall scale for a walked step

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Splitting a material into steps

**Files:**
- Create: `src/lib/walkthrough.ts`
- Test: `src/lib/walkthrough.test.ts`

**Interfaces:**
- Consumes: nothing. This module is pure — no database, no model, no imports.
- Produces:
  - `type WalkthroughStepSeed = { ordinal: number; label: string; sourceText: string }`
  - `type WalkthroughStepView = { id: string; ordinal: number; label: string; sourceText: string; explanation: string | null; recallPrompt: string | null }`
  - `const SHORT_SLIDE_CHARS = 120`
  - `function splitSlides(text: string): WalkthroughStepSeed[]` — an empty array when the text carries no `Slide N:` markers, which is the caller's signal to take the reading path.
  - `function splitSections(text: string, headings: string[]): WalkthroughStepSeed[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/walkthrough.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSections, splitSlides } from "./walkthrough.ts";

const long = (word: string) => `${word} `.repeat(40).trim();

test("splitSlides makes one step per slide marker", () => {
  const deck = [
    `Slide 1: Photosynthesis\n${long("light")}`,
    `Slide 2: The Calvin cycle\n${long("carbon")}`,
  ].join("\n");
  const steps = splitSlides(deck);
  assert.equal(steps.length, 2);
  assert.deepEqual(
    steps.map((s) => s.label),
    ["Slide 1", "Slide 2"]
  );
  assert.equal(steps[0].ordinal, 0);
  assert.match(steps[0].sourceText, /^Slide 1: Photosynthesis/);
});

test("splitSlides folds a title card into the slide it introduces", () => {
  const deck = ["Slide 3: Week 4", `Slide 4: Enzyme kinetics\n${long("substrate")}`].join("\n");
  const steps = splitSlides(deck);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].label, "Slides 3-4");
  assert.match(steps[0].sourceText, /Week 4/);
  assert.match(steps[0].sourceText, /Enzyme kinetics/);
});

test("splitSlides folds a short final slide backwards", () => {
  const deck = [
    `Slide 1: Intro\n${long("alpha")}`,
    `Slide 2: Body\n${long("beta")}`,
    "Slide 3: Questions?",
  ].join("\n");
  const steps = splitSlides(deck);
  assert.equal(steps.length, 2);
  assert.equal(steps[1].label, "Slides 2-3");
  assert.match(steps[1].sourceText, /Questions\?/);
});

test("splitSlides ignores the word slide used in prose", () => {
  assert.deepEqual(splitSlides("as shown on the slide before this one"), []);
});

test("splitSlides returns nothing for text with no markers, so the caller falls back", () => {
  assert.deepEqual(splitSlides("A reading with no deck structure at all."), []);
});

test("splitSections cuts on the headings it can find", () => {
  const reading =
    "Preamble text.\n\nWhat is a set?\nA set is a collection.\n\nSubsets\nA is a subset of B.";
  const steps = splitSections(reading, ["What is a set?", "Subsets"]);
  assert.equal(steps.length, 2);
  assert.deepEqual(
    steps.map((s) => s.label),
    ["What is a set?", "Subsets"]
  );
  // The opening paragraph belongs to the first step rather than being dropped.
  assert.match(steps[0].sourceText, /Preamble text\./);
  assert.match(steps[1].sourceText, /subset of B/);
});

test("splitSections skips a heading the model invented", () => {
  const reading = "Subsets\nA is a subset of B.";
  const steps = splitSections(reading, ["Cardinality", "Subsets"]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].label, "Subsets");
});

test("splitSections falls back to one step when no heading matches", () => {
  const steps = splitSections("Unstructured prose with no headings.", ["Nope"]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].label, "The whole text");
  assert.equal(steps[0].sourceText, "Unstructured prose with no headings.");
});

test("splitSections returns nothing for empty text", () => {
  assert.deepEqual(splitSections("   \n  ", ["Anything"]), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './walkthrough.ts'`.

- [ ] **Step 3: Write the module**

Create `src/lib/walkthrough.ts`:

```ts
/**
 * Where a walkthrough's steps come from. Pure: the routes own the database and
 * the model calls, this owns every boundary decision.
 *
 * Slides split on the `Slide N:` markers the pptx extractor emits — the same
 * shape `slideNumberFromChunk` in citations.ts depends on. Prose has no such
 * marker, so a reading is cut on headings the model supplies, and anything the
 * model names that is not actually in the text is skipped rather than guessed at.
 */

export type WalkthroughStepSeed = { ordinal: number; label: string; sourceText: string };

/** One step as the client sees it, once it exists as a row. */
export type WalkthroughStepView = {
  id: string;
  ordinal: number;
  label: string;
  sourceText: string;
  explanation: string | null;
  recallPrompt: string | null;
};

/**
 * A slide with less body text than this is a title card, a section divider, or a
 * lone image: it has nothing to teach on its own. A walkthrough that makes you
 * press Next through "Week 4" is a walkthrough people stop using.
 * ponytail: 120 chars is a guess; it is a threshold, so it is a knob.
 */
export const SHORT_SLIDE_CHARS = 120;

type RawSlide = { first: number; last: number; text: string };

/** Everything after the `Slide N:` marker itself — what the slide actually says. */
function slideBody(block: string): string {
  return block.replace(/^Slide \d+\s*:/, "").trim();
}

function slideLabel(slide: RawSlide): string {
  return slide.first === slide.last ? `Slide ${slide.first}` : `Slides ${slide.first}-${slide.last}`;
}

export function splitSlides(text: string): WalkthroughStepSeed[] {
  const starts: { index: number; num: number }[] = [];
  for (const match of text.matchAll(/^Slide (\d+)\s*:/gm)) {
    const num = Number(match[1]);
    if (Number.isFinite(num)) starts.push({ index: match.index, num });
  }
  if (starts.length === 0) return [];

  const raw: RawSlide[] = starts.map((start, i) => ({
    first: start.num,
    last: start.num,
    text: text.slice(start.index, starts[i + 1]?.index ?? text.length).trim(),
  }));

  // Forward fold: a short slide introduces the next one, so it joins it.
  const folded: RawSlide[] = [];
  let carry: RawSlide | null = null;
  for (let i = 0; i < raw.length; i++) {
    const slide = raw[i];
    const merged: RawSlide =
      carry === null
        ? slide
        : { first: carry.first, last: slide.last, text: `${carry.text}\n\n${slide.text}` };
    const isLast = i === raw.length - 1;
    if (!isLast && slideBody(slide.text).length < SHORT_SLIDE_CHARS) {
      carry = merged;
      continue;
    }
    folded.push(merged);
    carry = null;
  }

  // Backward fold: a short closing slide has nothing after it to introduce.
  if (folded.length > 1) {
    const last = folded[folded.length - 1];
    if (slideBody(last.text).length < SHORT_SLIDE_CHARS) {
      const prev = folded[folded.length - 2];
      folded.splice(folded.length - 2, 2, {
        first: prev.first,
        last: last.last,
        text: `${prev.text}\n\n${last.text}`,
      });
    }
  }

  return folded.map((slide, i) => ({
    ordinal: i,
    label: slideLabel(slide),
    sourceText: slide.text,
  }));
}

export function splitSections(text: string, headings: string[]): WalkthroughStepSeed[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  // Each heading is looked for after the previous one, so a phrase that also
  // appears in an earlier paragraph cannot cut the reading backwards.
  const cuts: { index: number; heading: string }[] = [];
  let from = 0;
  for (const heading of headings) {
    const at = trimmed.indexOf(heading, from);
    if (at < 0) continue;
    cuts.push({ index: at, heading });
    from = at + heading.length;
  }

  if (cuts.length === 0) return [{ ordinal: 0, label: "The whole text", sourceText: trimmed }];

  return cuts.map((cut, i) => {
    const end = cuts[i + 1]?.index ?? trimmed.length;
    // Text before the first heading is the reading's own opening: it joins the
    // first step rather than disappearing.
    const start = i === 0 ? 0 : cut.index;
    return { ordinal: i, label: cut.heading, sourceText: trimmed.slice(start, end).trim() };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all nine walkthrough tests.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/walkthrough.ts src/lib/walkthrough.test.ts
git commit -m "feat: split a deck or reading into walkthrough steps

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Prompts and validation schemas

**Files:**
- Create: `src/lib/prompts/walkthrough.ts`
- Modify: `src/lib/validation.ts` (append, following the `blurtResponseSchema` block at `:149-170`)
- Test: `src/lib/walkthrough.test.ts` (append)

**Interfaces:**
- Consumes: `UNTRUSTED_CONTENT_CLAUSE` from `@/lib/prompts/shared`.
- Produces:
  - `WALKTHROUGH_OUTLINE_SYSTEM_PROMPT`, `buildWalkthroughOutlineUserPrompt(title: string, text: string): string`
  - `WALKTHROUGH_TEACH_SYSTEM_PROMPT`, `buildWalkthroughTeachUserPrompt(input: { materialTitle: string; kind: "SLIDES" | "READING"; label: string; sourceText: string }): string`
  - `WALKTHROUGH_RECALL_SYSTEM_PROMPT`, `buildWalkthroughRecallUserPrompt(sourceText: string, explanation: string, answer: string): string`
  - Schemas `walkthroughOutlineResponseSchema`, `walkthroughTeachResponseSchema`, `walkthroughRecallResponseSchema`, `walkthroughRecallSubmitSchema`, `walkthroughStepIndexSchema`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/walkthrough.test.ts`, adding these two imports beside the existing one at the top of the file:

```ts
import {
  walkthroughOutlineResponseSchema,
  walkthroughRecallResponseSchema,
  walkthroughStepIndexSchema,
  walkthroughTeachResponseSchema,
} from "./validation.ts";
import { buildWalkthroughTeachUserPrompt } from "./prompts/walkthrough.ts";
```

```ts
test("walkthroughOutlineResponseSchema defaults a missing heading list to empty", () => {
  assert.deepEqual(walkthroughOutlineResponseSchema.parse({}).headings, []);
});

test("walkthroughTeachResponseSchema requires both halves of a step", () => {
  assert.throws(() => walkthroughTeachResponseSchema.parse({ explanation: "because" }));
  const parsed = walkthroughTeachResponseSchema.parse({
    explanation: "Light reactions make ATP.",
    recallPrompt: "What do the light reactions produce?",
  });
  assert.equal(parsed.recallPrompt, "What do the light reactions produce?");
});

test("walkthroughRecallResponseSchema fills in the arrays a model left out", () => {
  const parsed = walkthroughRecallResponseSchema.parse({ covered: ["ATP"] });
  assert.deepEqual(parsed.missed, []);
  assert.deepEqual(parsed.wrong, []);
});

test("walkthroughStepIndexSchema rejects a negative step", () => {
  assert.throws(() => walkthroughStepIndexSchema.parse({ stepIndex: -1 }));
  assert.equal(walkthroughStepIndexSchema.parse({ stepIndex: 4 }).stepIndex, 4);
});

test("the teaching prompt tells a deck and a reading apart", () => {
  const deck = buildWalkthroughTeachUserPrompt({
    materialTitle: "Week 4",
    kind: "SLIDES",
    label: "Slide 7",
    sourceText: "Slide 7: Enzymes\n- lower activation energy",
  });
  const reading = buildWalkthroughTeachUserPrompt({
    materialTitle: "Chapter 2",
    kind: "READING",
    label: "Subsets",
    sourceText: "Subsets\nA is a subset of B when…",
  });
  assert.match(deck, /slide/i);
  assert.match(reading, /section/i);
  assert.notEqual(deck, reading);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `walkthroughOutlineResponseSchema` is not exported from `./validation.ts`.

- [ ] **Step 3: Write the prompts module**

Create `src/lib/prompts/walkthrough.ts`:

```ts
import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

/** A reading has no `Slide N:` marker, so its steps come from headings. */
export const WALKTHROUGH_OUTLINE_SYSTEM_PROMPT = `You are dividing a piece of course reading into the sections a student should study one at a time.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "headings": [string]   // the section headings, in the order they appear in the text
}

Guidelines:
- Every heading must be copied VERBATIM from the text, character for character. A heading that is not in the text is dropped, and its section is lost with it.
- Prefer the text's own headings. Where it has none, copy the first line of each section instead.
- Aim for sections a student can study in a few minutes: between 3 and 20 of them for a normal reading.
- Return an empty array if the text has no usable section structure at all.

${UNTRUSTED_CONTENT_CLAUSE}`;

/** One reading is sent in full, once, to plan its sections. */
const MAX_OUTLINE_CHARS = 40_000;

export function buildWalkthroughOutlineUserPrompt(title: string, text: string): string {
  return `Reading: "${title}"\n\nDivide it into sections following the required JSON shape.\n\nTEXT:\n"""\n${text.slice(0, MAX_OUTLINE_CHARS)}\n"""`;
}

export const WALKTHROUGH_TEACH_SYSTEM_PROMPT = `You are a tutor walking a student through one piece of their own course material, one step at a time.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "explanation":  string,   // what this step means, in 80-200 words
  "recallPrompt": string    // ONE question the student answers from memory, before reading your explanation
}

Guidelines:
- Teach only what this step's text supports. Do not import facts from elsewhere in the course, and do not speculate about what the lecturer meant.
- The explanation is prose, not a restatement: a student who has read the step's text should learn something from it.
- The recall prompt asks for understanding, not for a word ("Why does X follow from Y?", not "What is X called?").
- One question. Not two joined by "and".

${UNTRUSTED_CONTENT_CLAUSE}`;

/** How each kind of material is read. This is the whole of the tailoring. */
const KIND_GUIDANCE = {
  SLIDES:
    "This step is a slide from a lecture deck. Its bullets are shorthand for what the lecturer said out loud: explain the thing the bullets stand for, in the deck's running context, rather than rephrasing them.",
  READING:
    "This step is a section of prose. A section is a move in an argument: say what it establishes, and how it advances what came before it.",
} as const;

export function buildWalkthroughTeachUserPrompt(input: {
  materialTitle: string;
  kind: "SLIDES" | "READING";
  label: string;
  sourceText: string;
}): string {
  return `Material: "${input.materialTitle}"\nStep: ${input.label}\n\n${KIND_GUIDANCE[input.kind]}\n\nWrite this step following the required JSON shape.\n\nTHIS STEP'S TEXT:\n"""\n${input.sourceText}\n"""`;
}

export const WALKTHROUGH_RECALL_SYSTEM_PROMPT = `You are marking what a student recalled about one step of their course material, answered from memory.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "covered": [string],   // points from this step the student did recall, one short phrase each
  "missed":  [string],   // important points from this step the student did not mention
  "wrong":   [           // things the student stated that this step contradicts
    { "claim": string, "correction": string }
  ]
}

Guidelines:
- Judge against this step only. A true statement this step does not make is not a missed point.
- "missed" holds what is worth studying next, so name the concept rather than quoting the sentence: at most 6, most important first.
- Credit a point as covered when the student got the idea, even if the wording is loose. This is recall practice, not a spelling test.
- "correction" must be a single sentence a student could study from on its own.
- Return empty arrays rather than inventing entries.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildWalkthroughRecallUserPrompt(
  sourceText: string,
  explanation: string,
  answer: string
): string {
  return `Here is the step, then what it was explained to say, then what the student wrote from memory. Mark the answer following the required JSON shape.\n\nSTEP TEXT:\n"""\n${sourceText}\n"""\n\nEXPLANATION GIVEN:\n"""\n${explanation}\n"""\n\nWHAT THE STUDENT REMEMBERED:\n"""\n${answer}\n"""`;
}
```

- [ ] **Step 4: Add the schemas**

Append to `src/lib/validation.ts`:

```ts
/**
 * A walkthrough's three model responses, and its two request bodies. Every
 * string is capped, not just every array: this text becomes flashcards and
 * ledger rows, and the model wrote it after reading course material it does
 * not control.
 */
export const walkthroughOutlineResponseSchema = z.object({
  headings: z.array(z.string().trim().min(1).max(200)).max(60).default([]),
});

export const walkthroughTeachResponseSchema = z.object({
  explanation: z.string().trim().min(1).max(4000),
  recallPrompt: z.string().trim().min(1).max(500),
});

export const walkthroughRecallResponseSchema = z.object({
  covered: z.array(z.string().trim().min(1).max(500)).max(40).default([]),
  missed: z.array(z.string().trim().min(1).max(500)).max(6).default([]),
  wrong: z
    .array(
      z.object({
        claim: z.string().trim().min(1).max(500),
        correction: z.string().trim().min(1).max(1000),
      })
    )
    .max(6)
    .default([]),
});

export const walkthroughRecallSubmitSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
});

export const walkthroughStepIndexSchema = z.object({
  stepIndex: z.number().int().min(0),
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/prompts/walkthrough.ts src/lib/validation.ts src/lib/walkthrough.test.ts
git commit -m "feat: walkthrough prompts and response schemas

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Create-or-return the walkthrough

**Files:**
- Create: `src/app/api/materials/[id]/walkthrough/route.ts`

**Interfaces:**
- Consumes: `splitSlides`, `splitSections`, `type WalkthroughStepSeed` (Task 2); `walkthroughOutlineResponseSchema`, `walkthroughStepIndexSchema`, `WALKTHROUGH_OUTLINE_SYSTEM_PROMPT`, `buildWalkthroughOutlineUserPrompt` (Task 3); `jsonError`, `withValidation` from `@/lib/api-utils`; `callLLMJSON`, `reasoningModel` from `@/lib/llm`.
- Produces: `POST /api/materials/[id]/walkthrough` returning `{ walkthrough: { id: string; stepIndex: number; steps: WalkthroughStepView[] } }`, and `PATCH` with body `{ stepIndex: number }` returning `{ stepIndex: number }`. Tasks 7 and 8 call both.

- [ ] **Step 1: Write the route**

Create `src/app/api/materials/[id]/walkthrough/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { splitSections, splitSlides, type WalkthroughStepSeed } from "@/lib/walkthrough";
import {
  WALKTHROUGH_OUTLINE_SYSTEM_PROMPT,
  buildWalkthroughOutlineUserPrompt,
} from "@/lib/prompts/walkthrough";
import { walkthroughOutlineResponseSchema, walkthroughStepIndexSchema } from "@/lib/validation";

const RETRY_MESSAGE = "The model's response didn't match the expected format. You can retry this step.";

/** Only a deck or a reading is walked: a syllabus is a reference document. */
const WALKABLE: readonly string[] = ["SLIDES", "READING"];

function view(walkthrough: {
  id: string;
  stepIndex: number;
  steps: {
    id: string;
    ordinal: number;
    label: string;
    sourceText: string;
    explanation: string | null;
    recallPrompt: string | null;
  }[];
}) {
  return {
    id: walkthrough.id,
    stepIndex: walkthrough.stepIndex,
    steps: walkthrough.steps.map((step) => ({
      id: step.id,
      ordinal: step.ordinal,
      label: step.label,
      sourceText: step.sourceText,
      explanation: step.explanation,
      recallPrompt: step.recallPrompt,
    })),
  };
}

/**
 * Creates the walkthrough for a material, or returns the one already there.
 *
 * Idempotent on purpose: the button that calls this is the button a student
 * clicks to resume, and rebuilding would silently drop their position and every
 * explanation already paid for.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const material = await db.material.findUnique({
    where: { id },
    include: { walkthrough: { include: { steps: { orderBy: { ordinal: "asc" } } } } },
  });
  if (!material) return jsonError("Material not found", 404);
  if (material.walkthrough) return NextResponse.json({ walkthrough: view(material.walkthrough) });

  if (!WALKABLE.includes(material.kind)) {
    return jsonError("Only slide decks and readings can be walked through", 422);
  }
  if (!material.text.trim()) {
    return jsonError("There is no extracted text in this material to walk through", 422);
  }

  let seeds: WalkthroughStepSeed[] = splitSlides(material.text);
  if (seeds.length === 0) {
    // A reading, or a deck that arrived as flat text with no slide markers.
    let headings: string[];
    try {
      const raw = await callLLMJSON({
        model: reasoningModel(),
        systemPrompt: WALKTHROUGH_OUTLINE_SYSTEM_PROMPT,
        userPrompt: buildWalkthroughOutlineUserPrompt(material.title, material.text),
      });
      headings = (await walkthroughOutlineResponseSchema.parseAsync(raw)).headings;
    } catch (e) {
      const message =
        e instanceof ZodError
          ? RETRY_MESSAGE
          : e instanceof Error
            ? e.message
            : "Planning the walkthrough failed";
      return jsonError(message, 502);
    }
    seeds = splitSections(material.text, headings);
  }
  if (seeds.length === 0) return jsonError("This material has no text to walk through", 422);

  const walkthrough = await db.walkthrough.create({
    data: {
      materialId: id,
      steps: {
        create: seeds.map((seed) => ({
          ordinal: seed.ordinal,
          label: seed.label,
          sourceText: seed.sourceText,
        })),
      },
    },
    include: { steps: { orderBy: { ordinal: "asc" } } },
  });

  return NextResponse.json({ walkthrough: view(walkthrough) });
}

/** Moving without answering: Back, and skipping a step. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(walkthroughStepIndexSchema, body);
  if ("error" in result) return result.error;

  const walkthrough = await db.walkthrough.findUnique({
    where: { materialId: id },
    include: { _count: { select: { steps: true } } },
  });
  if (!walkthrough) return jsonError("This material has no walkthrough yet", 404);

  // Clamped rather than rejected: a stale tab asking for step 40 of a 12-step
  // walkthrough should land on the last step, not throw at the student.
  const stepIndex = Math.min(result.data.stepIndex, Math.max(0, walkthrough._count.steps - 1));
  await db.walkthrough.update({ where: { id: walkthrough.id }, data: { stepIndex } });
  return NextResponse.json({ stepIndex });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/materials/[id]/walkthrough/route.ts"
git commit -m "feat: create or resume a material's walkthrough

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Teach one step

**Files:**
- Create: `src/app/api/materials/[id]/walkthrough/steps/[stepId]/teach/route.ts`

**Interfaces:**
- Consumes: `walkthroughTeachResponseSchema`, `WALKTHROUGH_TEACH_SYSTEM_PROMPT`, `buildWalkthroughTeachUserPrompt` (Task 3); `jsonError` from `@/lib/api-utils`; `callLLMJSON`, `reasoningModel` from `@/lib/llm`.
- Produces: `POST /api/materials/[id]/walkthrough/steps/[stepId]/teach` returning `{ step: WalkthroughStepView }` with `explanation` and `recallPrompt` non-null. Task 7 calls it on arriving at an untaught step.

- [ ] **Step 1: Write the route**

Create `src/app/api/materials/[id]/walkthrough/steps/[stepId]/teach/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import {
  WALKTHROUGH_TEACH_SYSTEM_PROMPT,
  buildWalkthroughTeachUserPrompt,
} from "@/lib/prompts/walkthrough";
import { walkthroughTeachResponseSchema } from "@/lib/validation";

const RETRY_MESSAGE = "The model's response didn't match the expected format. You can retry this step.";

function view(step: {
  id: string;
  ordinal: number;
  label: string;
  sourceText: string;
  explanation: string | null;
  recallPrompt: string | null;
}) {
  return {
    id: step.id,
    ordinal: step.ordinal,
    label: step.label,
    sourceText: step.sourceText,
    explanation: step.explanation,
    recallPrompt: step.recallPrompt,
  };
}

/**
 * Writes one step's explanation and recall prompt, once, and caches them on the
 * row. Called on arriving at a step, so a deck costs one completion per slide
 * actually reached rather than one per slide in the file.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await params;

  const step = await db.walkthroughStep.findUnique({
    where: { id: stepId },
    include: { walkthrough: { include: { material: { select: { title: true, kind: true } } } } },
  });
  // The material in the path must own the step: otherwise a step id from one
  // course could be taught under another material's text.
  if (!step || step.walkthrough.materialId !== id) return jsonError("Step not found", 404);

  if (step.explanation && step.recallPrompt) return NextResponse.json({ step: view(step) });

  let parsed;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: WALKTHROUGH_TEACH_SYSTEM_PROMPT,
      userPrompt: buildWalkthroughTeachUserPrompt({
        materialTitle: step.walkthrough.material.title,
        kind: step.walkthrough.material.kind === "SLIDES" ? "SLIDES" : "READING",
        label: step.label,
        sourceText: step.sourceText,
      }),
    });
    parsed = await walkthroughTeachResponseSchema.parseAsync(raw);
  } catch (e) {
    const message =
      e instanceof ZodError
        ? RETRY_MESSAGE
        : e instanceof Error
          ? e.message
          : "Writing this step failed";
    return jsonError(message, 502);
  }

  const updated = await db.walkthroughStep.update({
    where: { id: stepId },
    data: { explanation: parsed.explanation, recallPrompt: parsed.recallPrompt },
  });

  return NextResponse.json({ step: view(updated) });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/materials/[id]/walkthrough/steps/[stepId]/teach/route.ts"
git commit -m "feat: write and cache one walkthrough step

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Grade a step's recall

**Files:**
- Create: `src/app/api/materials/[id]/walkthrough/steps/[stepId]/recall/route.ts`

**Interfaces:**
- Consumes: `walkthroughRecallSubmitSchema`, `walkthroughRecallResponseSchema`, `WALKTHROUGH_RECALL_SYSTEM_PROMPT`, `buildWalkthroughRecallUserPrompt` (Task 3); `recallRow`, `settleMisconceptions`, `type RecallEvent` from `@/lib/recall-log`; `normalizeQuality` from `@/lib/recall` (Task 1); `assertSingleParent` from `@/lib/cards`.
- Produces: `POST /api/materials/[id]/walkthrough/steps/[stepId]/recall` with body `{ answer: string }`, returning `{ feedback: { covered: string[]; missed: string[]; wrong: { claim: string; correction: string }[] }, quality: number, cardsCreated: number, stepIndex: number }`. Task 7 renders all four.

- [ ] **Step 1: Write the route**

Create `src/app/api/materials/[id]/walkthrough/steps/[stepId]/recall/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { assertSingleParent } from "@/lib/cards";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import {
  WALKTHROUGH_RECALL_SYSTEM_PROMPT,
  buildWalkthroughRecallUserPrompt,
} from "@/lib/prompts/walkthrough";
import { normalizeQuality } from "@/lib/recall";
import { recallRow, settleMisconceptions, type RecallEvent } from "@/lib/recall-log";
import { walkthroughRecallResponseSchema, walkthroughRecallSubmitSchema } from "@/lib/validation";

/** Marks a card as born from a walkthrough, so a deck shows where it came from. */
const WALKTHROUGH_SOURCE_TERM = "From a walkthrough";

const RETRY_MESSAGE = "The model's response didn't match the expected format. You can retry this step.";

/**
 * The student says what they remember of one step, before reading the
 * explanation again. What they missed becomes cards, the attempt becomes one
 * ledger row, and the walkthrough moves on.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  const { id, stepId } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(walkthroughRecallSubmitSchema, body);
  if ("error" in result) return result.error;

  const step = await db.walkthroughStep.findUnique({
    where: { id: stepId },
    include: {
      walkthrough: {
        include: { material: { select: { title: true } }, _count: { select: { steps: true } } },
      },
    },
  });
  if (!step || step.walkthrough.materialId !== id) return jsonError("Step not found", 404);
  if (!step.explanation) return jsonError("This step hasn't been written yet", 409);

  let parsed;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: WALKTHROUGH_RECALL_SYSTEM_PROMPT,
      userPrompt: buildWalkthroughRecallUserPrompt(
        step.sourceText,
        step.explanation,
        result.data.answer
      ),
    });
    parsed = await walkthroughRecallResponseSchema.parseAsync(raw);
  } catch (e) {
    const message =
      e instanceof ZodError
        ? RETRY_MESSAGE
        : e instanceof Error
          ? e.message
          : "Marking your answer failed";
    return jsonError(message, 502);
  }

  const event: RecallEvent = {
    raw: {
      kind: "WALKTHROUGH",
      covered: parsed.covered.length,
      missed: parsed.missed.length,
      wrong: parsed.wrong.length,
    },
    materialId: id,
    misconception: parsed.wrong[0]?.correction ?? parsed.missed[0] ?? null,
    detail: {
      step: step.label,
      covered: parsed.covered.length,
      missed: parsed.missed.length,
      wrong: parsed.wrong.length,
    },
  };

  const cards = [
    ...parsed.missed.map((point) => ({
      prompt: `You didn't mention this on ${step.label} of "${step.walkthrough.material.title}". Explain it: ${point}`,
      idealExplanation: point,
    })),
    ...parsed.wrong.map((item) => ({
      prompt: `You said: "${item.claim}". Explain what is actually the case.`,
      idealExplanation: item.correction,
    })),
  ];

  // Advancing is part of the same write: a student whose answer was graded and
  // whose cards were made should not land back on the step they just finished.
  const stepIndex = Math.min(step.ordinal + 1, Math.max(0, step.walkthrough._count.steps - 1));

  // One transaction, for the reason the blurt route gives: cards without the
  // event would schedule work the ledger cannot explain, and an event without
  // its cards loses the only part of the attempt worth keeping.
  await db.$transaction([
    ...(cards.length > 0
      ? [
          db.flashcard.createMany({
            data: cards.map((card) => ({
              ...assertSingleParent({ materialId: id }),
              prompt: card.prompt,
              idealExplanation: card.idealExplanation,
              sourceTerm: WALKTHROUGH_SOURCE_TERM,
            })),
          }),
        ]
      : []),
    db.reviewLog.create({ data: recallRow(event) }),
    db.walkthrough.update({ where: { id: step.walkthroughId }, data: { stepIndex } }),
  ]);

  // Outside the transaction, and caught: everything above is committed by now,
  // so a bookkeeping failure must not tell the student nothing was saved.
  const quality = normalizeQuality(event.raw);
  try {
    await settleMisconceptions(event);
  } catch (e) {
    console.error(
      `[recall] settling misconceptions after a walkthrough step on material ${id} failed:`,
      e
    );
  }

  return NextResponse.json({ feedback: parsed, quality, cardsCreated: cards.length, stepIndex });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors. If `db.flashcard.createMany` rejects `sourceTerm`, check the field's name in `prisma/schema.prisma` under `model Flashcard` and use the name the blurt route uses at `src/app/api/pages/[id]/blurt/route.ts:80-95`.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/materials/[id]/walkthrough/steps/[stepId]/recall/route.ts"
git commit -m "feat: grade a walkthrough step and make cards from what was missed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The walkthrough page

**Files:**
- Create: `src/app/materials/[id]/learn/page.tsx`
- Create: `src/components/walkthrough/WalkthroughRunner.tsx`

**Interfaces:**
- Consumes: the three routes from Tasks 4-6; `type WalkthroughStepView` (Task 2); `Button` from `@/components/ui/Button`; `Textarea` from `@/components/ui/Input`; `postTask` from `@/lib/tasks`.
- Produces: the route `/materials/[id]/learn`. Task 8's button navigates to it.

- [ ] **Step 1: Confirm the Textarea export name**

Run: `grep -n "export" src/components/ui/Input.tsx`
Expected: a `Textarea` export. If it is named differently, use that name in the import and the JSX below — do not add a new component.

- [ ] **Step 2: Write the server component**

Create `src/app/materials/[id]/learn/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { WalkthroughRunner } from "@/components/walkthrough/WalkthroughRunner";

export const dynamic = "force-dynamic";

export default async function LearnMaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const material = await db.material.findUnique({
    where: { id },
    include: {
      folder: { select: { id: true, name: true } },
      walkthrough: { include: { steps: { orderBy: { ordinal: "asc" } } } },
    },
  });
  // The walkthrough is created by the button that links here, so arriving
  // without one means a stale link or a deleted material either way.
  if (!material || !material.walkthrough || material.walkthrough.steps.length === 0) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <Link
          href={`/folders/${material.folderId}`}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          {material.folder.name}
        </Link>
        <h1 className="text-xl font-semibold text-ink">{material.title}</h1>
      </div>

      <WalkthroughRunner
        materialId={material.id}
        startIndex={material.walkthrough.stepIndex}
        steps={material.walkthrough.steps.map((step) => ({
          id: step.id,
          ordinal: step.ordinal,
          label: step.label,
          sourceText: step.sourceText,
          explanation: step.explanation,
          recallPrompt: step.recallPrompt,
        }))}
      />
    </main>
  );
}
```

- [ ] **Step 3: Write the runner**

Create `src/components/walkthrough/WalkthroughRunner.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { postTask } from "@/lib/tasks";
import type { WalkthroughStepView } from "@/lib/walkthrough";

type Feedback = {
  covered: string[];
  missed: string[];
  wrong: { claim: string; correction: string }[];
};

type Marked = { feedback: Feedback; quality: number; cardsCreated: number; stepIndex: number };

export function WalkthroughRunner({
  materialId,
  startIndex,
  steps: initialSteps,
}: {
  materialId: string;
  startIndex: number;
  steps: WalkthroughStepView[];
}) {
  const [steps, setSteps] = useState(initialSteps);
  const [index, setIndex] = useState(Math.min(startIndex, initialSteps.length - 1));
  const [teaching, setTeaching] = useState(false);
  const [marking, setMarking] = useState(false);
  const [answer, setAnswer] = useState("");
  const [marked, setMarked] = useState<Marked | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = steps[index];

  const teach = useCallback(async () => {
    setTeaching(true);
    setError(null);
    try {
      const data = (await postTask(
        `/api/materials/${materialId}/walkthrough/steps/${step.id}/teach`,
        "Could not write this step.",
        undefined,
        "Network error talking to the local server."
      )) as { step: WalkthroughStepView };
      setSteps((prev) => prev.map((s) => (s.id === data.step.id ? data.step : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not write this step.");
    } finally {
      setTeaching(false);
    }
  }, [materialId, step.id]);

  // A step is written once, on arrival. A failure leaves it unwritten and the
  // Retry button visible; it never advances on its own.
  useEffect(() => {
    if (!step.recallPrompt && !teaching && !error) void teach();
  }, [step.recallPrompt, teaching, error, teach]);

  async function submit() {
    if (!answer.trim()) return;
    setMarking(true);
    setError(null);
    try {
      const data = (await postTask(
        `/api/materials/${materialId}/walkthrough/steps/${step.id}/recall`,
        "Could not mark your answer.",
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer }),
        },
        "Network error talking to the local server."
      )) as Marked;
      setMarked(data);
      setRevealed(true);
    } catch (e) {
      // The answer stays in the box: a failed marking must not cost the typing.
      setError(e instanceof Error ? e.message : "Could not mark your answer.");
    } finally {
      setMarking(false);
    }
  }

  async function move(to: number) {
    const next = Math.max(0, Math.min(to, steps.length - 1));
    setIndex(next);
    setAnswer("");
    setMarked(null);
    setRevealed(false);
    setError(null);
    // Position is persisted so a refresh lands here again. A failure is silent
    // on purpose: the student has already moved, and a message about
    // bookkeeping would interrupt studying to report nothing they can act on.
    try {
      await fetch(`/api/materials/${materialId}/walkthrough`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIndex: next }),
      });
    } catch {
      // ignored, deliberately
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] font-medium uppercase tracking-wide text-muted-2">
        {step.label} · {index + 1} of {steps.length}
      </p>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-[13px] font-medium text-red-700">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(null);
              void teach();
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {!step.recallPrompt ? (
        <p className="flex items-center gap-2 text-sm text-muted-2">
          {teaching && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
          {teaching ? "Writing this step…" : "This step hasn't been written yet."}
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-sm font-medium text-ink">{step.recallPrompt}</p>
            <p className="mt-1 text-[12.5px] text-muted-2">
              Answer from memory first. The material is revealed after you do.
            </p>
          </div>

          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={marking || revealed}
            rows={5}
            placeholder="What do you remember about this step?"
          />

          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={marking || revealed || !answer.trim()}>
              {marking ? "Marking…" : "Answer"}
            </Button>
            {!revealed && (
              <Button variant="ghost" onClick={() => setRevealed(true)} disabled={marking}>
                Show me instead
              </Button>
            )}
          </div>

          {marked && (
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
              <p className="font-medium text-ink">
                Scored {marked.quality}/5
                {marked.cardsCreated > 0
                  ? ` · ${marked.cardsCreated} card${marked.cardsCreated === 1 ? "" : "s"} made from what you missed`
                  : ""}
              </p>
              {marked.feedback.missed.length > 0 && (
                <div>
                  <p className="font-medium text-ink">You didn&apos;t mention</p>
                  <ul className="list-disc pl-5 text-muted">
                    {marked.feedback.missed.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}
              {marked.feedback.wrong.map((item) => (
                <p key={item.claim} className="text-muted">
                  <span className="text-ink">{item.claim}</span> — {item.correction}
                </p>
              ))}
            </div>
          )}

          {revealed && (
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3">
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-muted">
                {step.sourceText}
              </pre>
              <p className="text-sm leading-relaxed text-ink">{step.explanation}</p>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => move(index - 1)} disabled={index === 0}>
          Back
        </Button>
        <Button variant="ghost" onClick={() => move(index + 1)} disabled={index === steps.length - 1}>
          Next
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/materials/[id]/learn/page.tsx" src/components/walkthrough/WalkthroughRunner.tsx
git commit -m "feat: walk a material one step at a time

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The Learn button and the delete warning

**Files:**
- Modify: `src/components/dashboard/MaterialList.tsx` — `MaterialSummary` (`:10-19`), `remove` (`:153-181`), the row's button group (`:225-234`)
- Modify: the server component that builds `MaterialSummary[]` — found in Step 1

**Interfaces:**
- Consumes: `POST /api/materials/[id]/walkthrough` (Task 4) and the page from Task 7.
- Produces: nothing downstream. This is the last task.

- [ ] **Step 1: Find and extend the list's data source**

Run: `grep -rn "MaterialSummary\|<MaterialList" src --include=*.tsx`
Expected: the server component that queries materials and passes them in. Add to its material query:

```ts
      walkthrough: { select: { id: true } },
```

and map it into each summary as:

```ts
      hasWalkthrough: material.walkthrough !== null,
```

- [ ] **Step 2: Extend the summary type**

In `src/components/dashboard/MaterialList.tsx`, add one field to `MaterialSummary`:

```ts
  /** Whether this material has a walkthrough, so delete can say it goes too. */
  hasWalkthrough: boolean;
```

- [ ] **Step 3: Add the Learn action**

Add this function beside `makeLecturePage`:

```ts
  /** Opens the walkthrough for a deck or a reading, creating it on first click.
   *  Under a task key like the other generators, so a double click makes one
   *  walkthrough and one navigation, not two. */
  async function learn(id: string, title: string) {
    setError(null);
    const outcome = await run(
      {
        key: `material:${id}:walkthrough`,
        label: `Preparing a walkthrough of "${title}"…`,
        href: `/folders/${folderId}`,
      },
      async () => {
        await postTask(
          `/api/materials/${id}/walkthrough`,
          "Could not prepare a walkthrough of that material.",
          undefined,
          "Network error talking to the local server."
        );
      }
    );
    if (outcome.status === "error") {
      setError(outcome.error ?? "Could not prepare a walkthrough of that material.");
      return;
    }
    router.push(`/materials/${id}/learn`);
  }
```

- [ ] **Step 4: Add the button to the row**

Beside the existing `const makingNotes = …` line inside the `materials.map` body, add:

```tsx
          const walking = task(`material:${material.id}:walkthrough`)?.status === "running";
```

Then wrap the existing SLIDES/READING branch (`:225-234`) in a fragment and put Learn first, so the row reads Learn, Lecture notes, Flashcards, Quiz:

```tsx
                {(material.kind === "SLIDES" || material.kind === "READING") && (
                  <>
                    <button
                      onClick={() => learn(material.id, material.title)}
                      disabled={walking}
                      title={`Walk through this ${material.kind === "SLIDES" ? "deck one slide" : "reading one section"} at a time`}
                      className="rounded-md px-2 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-brand-soft/50 hover:text-brand-ink disabled:opacity-50"
                    >
                      {walking ? "Preparing…" : "Learn"}
                    </button>
                    <button
                      onClick={() => makeLecturePage(material.id, material.title, material.kind)}
                      disabled={makingNotes}
                      title={`Make a lecture page from this ${material.kind === "SLIDES" ? "deck" : "reading"}, for a lecture with no recording`}
                      className="rounded-md px-2 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-brand-soft/50 hover:text-brand-ink disabled:opacity-50"
                    >
                      {makingNotes ? "Creating…" : "Lecture notes"}
                    </button>
                  </>
                )}
```

- [ ] **Step 5: Say what delete destroys**

`remove` names the cards and questions that go with a material. Add the walkthrough clause:

```ts
  async function remove(
    id: string,
    title: string,
    cards: number,
    questions: number,
    hasWalkthrough: boolean
  ) {
    // Cascade: the material's flashcards, quiz questions, search chunks and
    // walkthrough go with it. Every other delete in the app says what it takes;
    // this one used to take it silently.
    const alsoGone = [
      cards > 0 ? `${cards} flashcard${cards === 1 ? "" : "s"}` : null,
      questions > 0 ? `${questions} quiz question${questions === 1 ? "" : "s"}` : null,
      hasWalkthrough ? "its walkthrough and how far you got through it" : null,
    ].filter(Boolean);
```

and pass the flag at the call site (`:259-267`):

```tsx
                    remove(
                      material.id,
                      material.title,
                      material.flashcardCount,
                      material.quizCount,
                      material.hasWalkthrough
                    )
```

- [ ] **Step 6: Type-check, lint, and run the suite**

Run: `npx tsc --noEmit`
Expected: no errors, including in the server component changed in Step 1.

Run: `npm run lint`
Expected: no errors.

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/MaterialList.tsx src/app
git commit -m "feat: a Learn button on decks and readings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Manual verification before the PR

Three of these routes call a model, so the suite cannot prove them. Against a real course, in the dev server the user is already running (do not start or restart it):

1. Click **Learn** on a slide deck. The first step names a slide number and asks a question before showing anything.
2. Answer it. The feedback names what was missed, and the cards it claims appear on that material.
3. Refresh. It lands on the step you were on, and that step's explanation appears instantly — no second model call.
4. Click **Learn** on a reading. Its steps are sections, not slides.
5. Delete a material that has a walkthrough. The confirm dialog says the walkthrough and your progress go with it.

The PR's `## Verification` section reports this with real numbers: how many steps, how many cards, what the ledger recorded.
