# Lectern Phase 6 — The agent classroom

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A course topic can be pretested before its lecture exists, taught back to a confused
classmate after it does, and argued over by two agents the student interrupts — and every one of
those attempts lands in the same `ReviewLog` ledger that schedules the cards.

**Architecture:** `InterviewSession` gains a `mode` and a `CourseTopic` parent rather than growing
siblings — the ordered turn list, the answer, and the feedback are already the right shape for all
three modes, and `RecallTarget` already has a `topicId` column waiting for a course-scoped event.
The pure work (debate turn ordering, lesson scene validation, rubric selection) lives in
`src/lib/debate.ts`, `src/lib/lesson.ts`, and additions to `src/lib/interview.ts`, testable under
`node --test` without Prisma; the routes do the database and the completions and are not tested.
That split mirrors `recall.ts` / `recall-log.ts` from Phase 5.

**Tech Stack:** Next.js App Router, Prisma + SQLite, Zod, `node --test` via tsx, Tailwind,
lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-28-lectern-course-library-design.md` — §17.1 modes,
§17.2 recitation lessons, §17.3 pretesting, §17.4 entry points, §17.5 testing, §17.6 Phase 6.
Phase 5's ledger contract in §16.2–§16.3 is the thing every new grader writes through.

## Global Constraints

- **`writeRecall` (`src/lib/recall-log.ts`) is the only writer.** Nothing added by this phase calls
  `db.reviewLog.create` directly. Routes that must write inside their own transaction use
  `recallRow` + `settleMisconceptions`, exactly as `src/app/api/pages/[id]/blurt/route.ts` does.
- **A grader's own units go into `RecallRaw`, never a pre-converted 0-5.** Feynman grading emits
  0-100 and therefore writes `{ kind: "FEYNMAN", score }`. This deviates from spec §17.2's table,
  which says a `TEACH` scene writes an `INTERVIEW` event: converting 0-100 into a 1-5 rating at the
  call site is the exact error the `RecallRaw` union exists to prevent.
- **`VIVA` is today's behaviour on the default.** No existing session changes, and no existing
  interview flow gains a required step.
- **Every relation added to a session is `SetNull` on the topic side.** Deleting a `CourseTopic`
  must not erase the record that the student once argued about it. `InterviewTurn` stays `Cascade`
  on its session, unchanged.
- **Lessons are not persisted.** The scene list is generated per request and discarded; only the
  recall events survive.
- **Debate runs on the `REASONING` tier** (`reasoningModel()` from `src/lib/llm.ts`) and is capped
  at six exchanges per session.
- **Pretest questions are built from the topic title and syllabus text only** — never from the
  lecture, which by definition has not been watched.
- `PRETEST` events are recorded and never scheduled; `isSchedulable` in `src/lib/recall.ts`
  already enforces this and must not be touched.
- Migrations run through `npm run db:migrate`, which snapshots `prisma/dev.db` first.
- Tests are colocated as `src/lib/*.test.ts` — that is what `npm test`'s glob
  (`src/lib/**/*.test.ts`) picks up.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/debate.ts` | Pure debate turn algebra: who speaks next, exchange counting, the cap, pending interjections. |
| `src/lib/debate.test.ts` | Tests for the above. |
| `src/lib/lesson.ts` | Pure lesson shape: scene Zod schemas, `openOnRecall`, `dropUnbackedChecks`. |
| `src/lib/lesson.test.ts` | Tests for the above. |
| `src/lib/interview.test.ts` | Tests for the rubric and recall-scale selection added to `interview.ts`. |
| `src/lib/pretest.test.ts` | Tests that the pretest prompt cannot see the lecture. |
| `src/lib/prompts/protege.ts` | The confused-classmate question prompt. Grading reuses `feynman.ts`. |
| `src/lib/prompts/debate.ts` | The two agent personas and the exchange/interjection user prompts. |
| `src/lib/prompts/lesson.ts` | Stage-1 outline and stage-2 scenes prompts. |
| `src/lib/prompts/pretest.ts` | Prediction-question prompt, built from title + syllabus only. |
| `src/app/api/interview/[id]/debate/advance/route.ts` | One exchange: two completions, two turns. |
| `src/app/api/interview/[id]/debate/interject/route.ts` | Student turn, graded, one ledger event. |
| `src/app/api/folders/[id]/topics/[topicId]/lesson/route.ts` | Two-stage recitation generator. |
| `src/app/api/folders/[id]/topics/[topicId]/pretest/route.ts` | Generate three prediction questions. |
| `src/app/api/folders/[id]/topics/[topicId]/pretest/submit/route.ts` | Hold the guesses, write the events. |
| `src/components/interview/DebateRunner.tsx` | Transcript + interject box. |
| `src/components/course/LessonRunner.tsx` | Scene-by-scene recitation player. |
| `src/components/course/PretestDialog.tsx` | Three questions, no result shown. |
| `src/components/page/PretestReveal.tsx` | The held answers, revealed on the lecture. |

**Modified:**

| File | Change |
|---|---|
| `prisma/schema.prisma` | `InterviewMode` enum; `mode`/`persona`/`courseTopicId` on `InterviewSession`; `speaker` on `InterviewTurn`; `COURSE_TOPIC` on `InterviewSource`; `interviewSessions` back-relation on `CourseTopic`. |
| `src/lib/interview.ts` | Mode type, third schema variant, `rubricFor`, `recallRawFor`, widened `InterviewContext["source"]`. |
| `src/lib/validation.ts` | `debateInterjectSchema`, `debateUtteranceResponseSchema`, `pretestResponseSchema`, `pretestSubmitSchema`. |
| `src/app/api/interview/route.ts` | Accept `mode`, `persona`, `courseTopicId`; branch the opening turn on mode. |
| `src/app/api/interview/[id]/answer/route.ts` | Branch rubric on `session.mode`; write the mode's own `RecallRaw`; target `topicId`. |
| `src/components/interview/InterviewRunner.tsx` | Render `DebateRunner` when `mode === "DEBATE"`. |
| `src/app/interview/[id]/page.tsx` | Pass `mode`, `persona`, and the topic title through. |
| `src/components/course/CourseOverview.tsx` | Per-topic **Pretest** / **Recite** buttons, header **Debate** button. |
| `src/app/pages/[id]/page.tsx` | Mount `PretestReveal`; add the **Teach it back** button. |

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma:26-29` (`InterviewSource`), `:99-112` (`CourseTopic`), `:263-293` (`InterviewSession`, `InterviewTurn`)
- Create: `prisma/migrations/<timestamp>_agent_classroom/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `InterviewMode` enum (`VIVA | PROTEGE | DEBATE`); `InterviewSession.mode` (default `VIVA`),
  `.persona: String?`, `.courseTopicId: String?`, `.topic` relation; `InterviewTurn.speaker: String?`;
  `InterviewSource.COURSE_TOPIC`; `CourseTopic.interviewSessions` back-relation.

- [ ] **Step 1: Snapshot the database before anything touches the schema**

```bash
npm run db:backup
ls -1t prisma/backups | head -3
```

Expected: a fresh `.db` snapshot at the top of the listing. Do not proceed without it — `prisma/dev.db`
is the only copy of the user's transcripts and notes.

- [ ] **Step 2: Edit the schema**

In `prisma/schema.prisma`, extend the existing `InterviewSource` enum:

```prisma
enum InterviewSource {
  LECTURE
  TOPIC
  COURSE_TOPIC
}
```

Add the mode enum next to it:

```prisma
/// Which classroom the session runs in. VIVA is the examiner that existed before
/// Phase 6; PROTEGE is a confused classmate the student teaches; DEBATE is two
/// agents arguing a course concept while the student interjects.
enum InterviewMode {
  VIVA
  PROTEGE
  DEBATE
}
```

Extend `InterviewSession`:

```prisma
model InterviewSession {
  id        String          @id @default(cuid())
  title     String
  source    InterviewSource
  status    InterviewStatus @default(ACTIVE)
  pageId    String?
  topicText String?

  mode InterviewMode @default(VIVA)
  /// Free text: the agent's brief. Null on a plain viva.
  persona String?
  /// The syllabus topic a course-scoped session argues about or recites. Debate
  /// and recitation write ledger events against it, so without this column their
  /// events land with no target and the scheduler cannot see them.
  courseTopicId String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  page  Page?           @relation(fields: [pageId], references: [id], onDelete: SetNull)
  topic CourseTopic?    @relation(fields: [courseTopicId], references: [id], onDelete: SetNull)
  turns InterviewTurn[]

  @@index([pageId])
  @@index([status])
  @@index([courseTopicId])
}
```

Extend `InterviewTurn` with one column:

```prisma
model InterviewTurn {
  id              String   @id @default(cuid())
  sessionId       String
  order           Int
  question        String
  answer          String?
  answerAudioPath String?
  feedback        String?
  /// Null = the examiner asking. "You" = the student. Anything else is an agent
  /// name in a debate.
  speaker         String?
  createdAt       DateTime @default(now())

  session InterviewSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
}
```

Add the back-relation to `CourseTopic` (Prisma will not validate without it):

```prisma
model CourseTopic {
  // ...unchanged fields...
  folder            Folder             @relation(fields: [folderId], references: [id], onDelete: Cascade)
  reviewLogs        ReviewLog[]
  interviewSessions InterviewSession[]

  @@index([folderId, order])
}
```

- [ ] **Step 3: Generate the migration and apply it**

```bash
npx prisma migrate dev --name agent_classroom
```

Expected: a new folder under `prisma/migrations/`, and the generated client rebuilt into
`src/generated/prisma`.

- [ ] **Step 4: Verify a pre-migration session still reads as VIVA**

Every existing row predates `mode`, so the default is the only thing standing between this migration
and a broken interview page.

```bash
npx tsx -e '
import { db } from "./src/lib/db.ts";
const s = await db.interviewSession.findMany({ take: 5, select: { id: true, mode: true, source: true } });
console.log(s);
const bad = s.filter((r) => r.mode !== "VIVA");
if (bad.length) { console.error("NOT DEFAULTED:", bad); process.exit(1); }
console.log("ok: all pre-migration sessions read as VIVA");
'
```

Expected: `ok: all pre-migration sessions read as VIVA` (an empty array also passes — it means the
database has no sessions yet).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations src/generated/prisma
git commit -m "feat: add interview modes, personas, and a course-topic parent"
```

---

### Task 2: Mode plumbing in `src/lib/interview.ts`

**Files:**
- Modify: `src/lib/interview.ts`
- Create: `src/lib/interview.test.ts`

**Interfaces:**
- Consumes: `RecallRaw` from `src/lib/recall.ts`.
- Produces: `type InterviewMode = "VIVA" | "PROTEGE" | "DEBATE"`;
  `rubricFor(mode: InterviewMode): "INTERVIEWER" | "FEYNMAN"`;
  `recallRawFor(mode: InterviewMode, graded: { score: number }): RecallRaw`;
  `createInterviewSessionSchema` gaining a `COURSE_TOPIC` variant with `courseTopicId`, `mode`,
  `persona`, and a `mode` field defaulting to `"VIVA"` on the two existing variants;
  `InterviewContext["source"]` widened to include `"COURSE_TOPIC"`.
  `MAX_INTERVIEW_QUESTIONS` stays 6; `submitAnswerSchema`,
  `interviewQuestionResponseSchema`, `interviewFeedbackResponseSchema`, `QAPair`, and
  `averageScore` are unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/lib/interview.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rubricFor,
  recallRawFor,
  createInterviewSessionSchema,
} from "./interview.ts";

test("PROTEGE grades with the Feynman rubric, VIVA with the interviewer's", () => {
  assert.equal(rubricFor("PROTEGE"), "FEYNMAN");
  assert.equal(rubricFor("VIVA"), "INTERVIEWER");
  assert.equal(rubricFor("DEBATE"), "INTERVIEWER");
});

test("a protege score stays in its own units on the way to the ledger", () => {
  // The Feynman coach emits 0-100. Handing 80 to the ledger as an INTERVIEW
  // rating would read as a 5 on SM-2's scale; as a FEYNMAN score it normalizes
  // to 4, which is what an 80 means.
  assert.deepEqual(recallRawFor("PROTEGE", { score: 80 }), { kind: "FEYNMAN", score: 80 });
  assert.deepEqual(recallRawFor("VIVA", { score: 4 }), { kind: "INTERVIEW", rating: 4 });
  assert.deepEqual(recallRawFor("DEBATE", { score: 3 }), { kind: "INTERVIEW", rating: 3 });
});

test("a course-topic session needs a topic and accepts only classroom modes", () => {
  const ok = createInterviewSessionSchema.safeParse({
    source: "COURSE_TOPIC",
    courseTopicId: "topic_1",
    mode: "DEBATE",
  });
  assert.equal(ok.success, true);

  const missingTopic = createInterviewSessionSchema.safeParse({
    source: "COURSE_TOPIC",
    mode: "DEBATE",
  });
  assert.equal(missingTopic.success, false);

  const vivaOnACourseTopic = createInterviewSessionSchema.safeParse({
    source: "COURSE_TOPIC",
    courseTopicId: "topic_1",
    mode: "VIVA",
  });
  assert.equal(vivaOnACourseTopic.success, false);
});

test("a lecture session still defaults to the mode that existed before Phase 6", () => {
  const parsed = createInterviewSessionSchema.parse({
    source: "LECTURE",
    pageId: "page_1",
    title: "Fourier transforms",
  });
  assert.equal(parsed.mode, "VIVA");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- --test-name-pattern="rubric|protege score|course-topic session|before Phase 6"
```

Expected: FAIL — `rubricFor is not a function` / no export named `recallRawFor`.

- [ ] **Step 3: Implement**

In `src/lib/interview.ts`, add the import and the new exports. Leave `MAX_INTERVIEW_QUESTIONS`,
`submitAnswerSchema`, `interviewQuestionResponseSchema`, `interviewFeedbackResponseSchema`,
`QAPair`, and `averageScore` exactly as they are.

```ts
import type { RecallRaw } from "@/lib/recall";

export type InterviewMode = "VIVA" | "PROTEGE" | "DEBATE";

/** Which grader marks the answer. PROTEGE judges the explanation, not the answer. */
export type Rubric = "INTERVIEWER" | "FEYNMAN";

export function rubricFor(mode: InterviewMode): Rubric {
  return mode === "PROTEGE" ? "FEYNMAN" : "INTERVIEWER";
}

/**
 * The graded number in the units its grader produced. The Feynman coach emits
 * 0-100 and the interviewer 1-5; `normalizeQuality` knows how to map each, and
 * converting here would hide a scale error behind a plausible-looking integer.
 */
export function recallRawFor(mode: InterviewMode, graded: { score: number }): RecallRaw {
  return rubricFor(mode) === "FEYNMAN"
    ? { kind: "FEYNMAN", score: graded.score }
    : { kind: "INTERVIEW", rating: graded.score };
}
```

Widen the context type in the same file:

```ts
export type InterviewContext = {
  title: string;
  source: "LECTURE" | "TOPIC" | "COURSE_TOPIC";
  notesMarkdown?: string | null;
  transcriptText?: string | null;
  topicText?: string | null;
};
```

`describeContext` and `groundingInstruction` in `src/lib/prompts/interview.ts` branch on
`ctx.source === "LECTURE"` and fall through to the topic-shaped text otherwise, so a
`COURSE_TOPIC` context reads correctly there with no change.

Replace `createInterviewSessionSchema` with the three-variant union:

```ts
export const createInterviewSessionSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("LECTURE"),
    pageId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(300),
    mode: z.enum(["VIVA", "PROTEGE"]).default("VIVA"),
    persona: z.string().trim().max(600).optional(),
  }),
  z.object({
    source: z.literal("TOPIC"),
    topicText: z.string().trim().min(1).max(8000),
    title: z.string().trim().max(300).optional(),
    mode: z.enum(["VIVA", "PROTEGE"]).default("VIVA"),
    persona: z.string().trim().max(600).optional(),
  }),
  // A course-scoped session is the only one that can be a debate, because it is
  // the only one with a CourseTopic to hang the ledger event on.
  z.object({
    source: z.literal("COURSE_TOPIC"),
    courseTopicId: z.string().trim().min(1),
    title: z.string().trim().max(300).optional(),
    mode: z.enum(["PROTEGE", "DEBATE"]),
    persona: z.string().trim().max(600).optional(),
  }),
]);
```

- [ ] **Step 4: Run the tests**

```bash
npm test
```

Expected: PASS, including the 111 tests that already existed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/interview.ts src/lib/interview.test.ts
git commit -m "feat: pick a rubric and a recall scale from the interview mode"
```

---

### Task 3: The protege prompt and the graded answer path

**Files:**
- Create: `src/lib/prompts/protege.ts`
- Modify: `src/app/api/interview/route.ts`, `src/app/api/interview/[id]/answer/route.ts`

**Interfaces:**
- Consumes: `rubricFor`, `recallRawFor` (Task 2); `FEYNMAN_SYSTEM_PROMPT`, `buildFeynmanUserPrompt`
  from `src/lib/prompts/feynman.ts`; `feynmanFeedbackSchema` from `src/lib/validation.ts`
  (fields: `score` 0-100, `verdict`, `strengths[]`, `gaps[]`, `jargon[]`, `followUp`);
  `writeRecallSafely` from `src/lib/recall-log.ts`.
- Produces: `PROTEGE_QUESTION_SYSTEM_PROMPT`, `buildProtegeFirstQuestionUserPrompt(ctx)`,
  `buildProtegeNextQuestionUserPrompt(ctx, history)` in `src/lib/prompts/protege.ts`;
  `POST /api/interview` accepting `mode`/`persona`/`courseTopicId` and returning
  `{ session, firstTurn }` with `firstTurn: null` for a debate.

- [ ] **Step 1: Write the prompt module**

Create `src/lib/prompts/protege.ts`:

```ts
// The protege: a classmate who half-followed the lecture and needs it explained.
// Teaching a confused peer is a stronger generative task than answering an
// examiner, and it costs one prompt swap — the grading side reuses the Feynman
// coach's rubric unchanged.

import type { InterviewContext, QAPair } from "@/lib/interview";
import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

const PERSONA = `You are a classmate who attended the same lecture and only half-followed it. You are friendly, a little embarrassed, and genuinely trying to understand. You ask the student to explain one thing at a time, in their own words. You never explain the material yourself and you never hint at the answer — if you knew it, you would not be asking.`;

export const PROTEGE_QUESTION_SYSTEM_PROMPT = `${PERSONA}

Ask one short question (1-2 sentences) that asks the student to explain or teach something from the material. Prefer "why" and "how" over "what" — a question they can answer with a term is a question you learn nothing from.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{ "question": string }

${UNTRUSTED_CONTENT_CLAUSE}`;

function describe(ctx: InterviewContext): string {
  const parts = [`What the lecture was about: "${ctx.title}"`];
  if (ctx.notesMarkdown) parts.push(`NOTES:\n"""\n${ctx.notesMarkdown.slice(0, 6000)}\n"""`);
  if (ctx.transcriptText) parts.push(`TRANSCRIPT:\n"""\n${ctx.transcriptText.slice(0, 6000)}\n"""`);
  if (ctx.topicText) parts.push(`TOPIC:\n"""\n${ctx.topicText.slice(0, 6000)}\n"""`);
  return parts.join("\n\n");
}

export function buildProtegeFirstQuestionUserPrompt(ctx: InterviewContext): string {
  return `${describe(ctx)}\n\nAsk the FIRST thing you got lost on. Pick something central rather than a detail. Return the required JSON.`;
}

export function buildProtegeNextQuestionUserPrompt(ctx: InterviewContext, history: QAPair[]): string {
  const transcript = history
    .map((qa) => `You asked: ${qa.question}\nThey explained: ${qa.answer}`)
    .join("\n\n");
  return `${describe(ctx)}\n\nWHAT YOU HAVE ASKED SO FAR:\n"""\n${transcript}\n"""\n\nAsk your NEXT question. If their last explanation left something vague or used a word you would not know, ask about that. Otherwise move to the next thing you got lost on. Do not repeat a question. Return the required JSON.`;
}
```

- [ ] **Step 2: Branch the session-creation route on mode**

In `src/app/api/interview/route.ts`:

1. Add the import:

```ts
import { PROTEGE_QUESTION_SYSTEM_PROMPT, buildProtegeFirstQuestionUserPrompt } from "@/lib/prompts/protege";
```

2. Declare `let courseTopicId: string | null = null;` beside the existing `pageId` / `topicText`
   declarations, and add a `COURSE_TOPIC` branch after the `LECTURE` branch:

```ts
} else if (input.source === "COURSE_TOPIC") {
  const topic = await db.courseTopic.findUnique({
    where: { id: input.courseTopicId },
    select: { id: true, title: true },
  });
  if (!topic) return jsonError("Topic not found", 404);

  courseTopicId = topic.id;
  title = input.title?.trim() || topic.title;
  context = { title, source: "COURSE_TOPIC", topicText: topic.title };
} else {
```

3. Persist the new columns:

```ts
const session = await db.interviewSession.create({
  data: {
    title,
    source: input.source,
    pageId,
    topicText,
    courseTopicId,
    mode: input.mode,
    persona: input.persona ?? null,
  },
});
```

4. A debate has no opening question to generate — its first exchange comes from the advance route —
   so return before the completion. Put this immediately after the create, ahead of the existing
   `try`:

```ts
if (input.mode === "DEBATE") {
  return NextResponse.json({ session, firstTurn: null });
}
```

5. Inside the existing `try`, pick the prompt pair:

```ts
const usingProtege = input.mode === "PROTEGE";
const raw = await callLLMJSON({
  model: MODEL,
  systemPrompt: usingProtege ? PROTEGE_QUESTION_SYSTEM_PROMPT : INTERVIEW_QUESTION_SYSTEM_PROMPT,
  userPrompt: usingProtege
    ? buildProtegeFirstQuestionUserPrompt(context)
    : buildFirstQuestionUserPrompt(context),
});
```

Leave the surrounding `catch` and its session-delete rollback exactly as they are.

- [ ] **Step 3: Branch the answer route on the rubric**

In `src/app/api/interview/[id]/answer/route.ts`:

1. Add imports:

```ts
import { rubricFor, recallRawFor } from "@/lib/interview";
import { FEYNMAN_SYSTEM_PROMPT, buildFeynmanUserPrompt } from "@/lib/prompts/feynman";
import { feynmanFeedbackSchema } from "@/lib/validation";
import { PROTEGE_QUESTION_SYSTEM_PROMPT, buildProtegeNextQuestionUserPrompt } from "@/lib/prompts/protege";
```

2. Replace the single grading block with a rubric branch. The two rubrics return different shapes, so
   the shared code below reads `score` and `firstImprovement` rather than the payload:

```ts
const rubric = rubricFor(session.mode);

let feedback: unknown;
let score: number;
let firstImprovement: string | null;
try {
  if (rubric === "FEYNMAN") {
    const raw = await callLLMJSON({
      model: MODEL,
      systemPrompt: FEYNMAN_SYSTEM_PROMPT,
      userPrompt: buildFeynmanUserPrompt({
        concept: turn.question,
        reference: context.notesMarkdown ?? context.transcriptText ?? context.topicText ?? undefined,
        explanation: answer,
        priorExplanations: session.turns
          .filter((t) => t.answer !== null && t.id !== turn.id)
          .map((t) => t.answer as string),
      }),
    });
    const parsed = await feynmanFeedbackSchema.parseAsync(raw);
    feedback = parsed;
    score = parsed.score;
    firstImprovement = parsed.gaps[0] ?? null;
  } else {
    const raw = await callLLMJSON({
      model: MODEL,
      systemPrompt: INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
      userPrompt: buildFeedbackUserPrompt(context, turn.question, answer),
    });
    const parsed = await interviewFeedbackResponseSchema.parseAsync(raw);
    feedback = parsed;
    score = parsed.score;
    firstImprovement = parsed.improvements[0] ?? null;
  }
} catch (e) {
  const message =
    e instanceof ZodError
      ? "The model's response didn't match the expected format. You can retry this step."
      : e instanceof Error
        ? e.message
        : "Failed to grade your answer";
  return jsonError(message, 502);
}
```

3. Build the context with the new source, so a `COURSE_TOPIC` protege session has something to
   ground against — replace the `topicText` line in the existing `context` literal:

```ts
const context: InterviewContext = {
  title: session.title,
  source: session.source,
  notesMarkdown: session.page?.notes?.markdown ?? null,
  transcriptText: session.page?.transcript?.rawText ?? null,
  topicText: session.topicText ?? session.topic?.title ?? null,
};
```

and add `topic: { select: { id: true, title: true } }` to the route's existing `include`.

4. Write the event in the mode's own units, and give a course-scoped session its target:

```ts
await writeRecallSafely({
  raw: recallRawFor(session.mode, { score }),
  pageId: session.pageId,
  topicId: session.courseTopicId,
  misconception: firstImprovement,
  detail: { question: turn.question, score, mode: session.mode },
});
```

5. In the follow-up-question block further down, pick the protege prompt when the session is one:

```ts
const usingProtege = session.mode === "PROTEGE";
const raw = await callLLMJSON({
  model: MODEL,
  systemPrompt: usingProtege ? PROTEGE_QUESTION_SYSTEM_PROMPT : INTERVIEW_QUESTION_SYSTEM_PROMPT,
  userPrompt: usingProtege
    ? buildProtegeNextQuestionUserPrompt(context, history)
    : buildNextQuestionUserPrompt(context, history),
});
```

Leave the `answeredCount >= MAX_INTERVIEW_QUESTIONS` completion path and the graceful-degradation
`catch` untouched.

- [ ] **Step 4: Typecheck, lint, test**

```bash
npx tsc --noEmit && npm run lint && npm test
```

Expected: clean, and the suite still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts/protege.ts src/lib/interview.ts src/app/api/interview
git commit -m "feat: teach it back to a classmate who half-followed the lecture"
```

---

### Task 4: Debate turn algebra

**Files:**
- Create: `src/lib/debate.ts`, `src/lib/debate.test.ts`

**Interfaces:**
- Consumes: nothing — pure, no Prisma, no network.
- Produces: `DEBATE_AGENTS: readonly ["Proponent", "Skeptic"]`; `STUDENT_SPEAKER = "You"`;
  `MAX_DEBATE_EXCHANGES = 6`; `type DebateTurn = { order: number; speaker: string | null; answer: string | null }`;
  `exchangeCount(turns): number`; `canAdvance(turns): boolean`; `nextOrder(turns): number`;
  `nextSpeaker(turns): string`; `pendingInterjection(turns): DebateTurn | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/debate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEBATE_AGENTS,
  MAX_DEBATE_EXCHANGES,
  STUDENT_SPEAKER,
  canAdvance,
  exchangeCount,
  nextOrder,
  nextSpeaker,
  pendingInterjection,
  type DebateTurn,
} from "./debate.ts";

function agentTurn(order: number, speaker: string): DebateTurn {
  return { order, speaker, answer: null };
}
function studentTurn(order: number, text: string): DebateTurn {
  return { order, speaker: STUDENT_SPEAKER, answer: text };
}

test("an exchange is one utterance from each agent", () => {
  assert.equal(exchangeCount([]), 0);
  assert.equal(exchangeCount([agentTurn(0, DEBATE_AGENTS[0])]), 0);
  assert.equal(
    exchangeCount([agentTurn(0, DEBATE_AGENTS[0]), agentTurn(1, DEBATE_AGENTS[1])]),
    1
  );
});

test("a student interjection does not count as an exchange", () => {
  const turns = [
    agentTurn(0, DEBATE_AGENTS[0]),
    agentTurn(1, DEBATE_AGENTS[1]),
    studentTurn(2, "But that ignores the boundary condition."),
  ];
  assert.equal(exchangeCount(turns), 1);
});

test("the agents alternate, and an interjection does not steal a turn", () => {
  assert.equal(nextSpeaker([]), DEBATE_AGENTS[0]);
  assert.equal(nextSpeaker([agentTurn(0, DEBATE_AGENTS[0])]), DEBATE_AGENTS[1]);
  const afterInterjection = [agentTurn(0, DEBATE_AGENTS[0]), studentTurn(1, "Wait — why?")];
  assert.equal(nextSpeaker(afterInterjection), DEBATE_AGENTS[1]);
});

test("orders keep climbing across interjections", () => {
  assert.equal(nextOrder([]), 0);
  assert.equal(nextOrder([agentTurn(0, DEBATE_AGENTS[0]), studentTurn(1, "hm")]), 2);
});

test("the debate stops at six exchanges", () => {
  const turns: DebateTurn[] = [];
  for (let i = 0; i < MAX_DEBATE_EXCHANGES * DEBATE_AGENTS.length; i++) {
    turns.push(agentTurn(i, DEBATE_AGENTS[i % DEBATE_AGENTS.length]));
  }
  assert.equal(exchangeCount(turns), MAX_DEBATE_EXCHANGES);
  assert.equal(canAdvance(turns), false);
  turns.pop();
  assert.equal(canAdvance(turns), true);
});

test("the agents owe an answer to the newest interjection only", () => {
  assert.equal(pendingInterjection([]), null);

  const answered = [
    agentTurn(0, DEBATE_AGENTS[0]),
    studentTurn(1, "First objection"),
    agentTurn(2, DEBATE_AGENTS[1]),
  ];
  assert.equal(pendingInterjection(answered), null);

  const unanswered = [...answered, studentTurn(3, "Second objection")];
  assert.equal(pendingInterjection(unanswered)?.answer, "Second objection");
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- --test-name-pattern="exchange|interjection|alternate|climbing|six exchanges"
```

Expected: FAIL — `Cannot find module './debate.ts'`.

- [ ] **Step 3: Implement**

Create `src/lib/debate.ts`:

```ts
// Debate turn algebra. Pure: the routes own the completions and the database,
// this owns who speaks next and when to stop. Split the same way recall.ts is
// split from recall-log.ts, and for the same reason — the arithmetic is the part
// worth pinning with tests.

/**
 * The two personas. Two, not three: a third voice triples the cost per exchange
 * and adds no distinction a student cannot already see.
 */
export const DEBATE_AGENTS = ["Proponent", "Skeptic"] as const;

/** The `speaker` value on a turn the student wrote. */
export const STUDENT_SPEAKER = "You";

/**
 * One exchange is one utterance from each agent.
 * ponytail: six is a context-window guess for free models, not a pedagogical one.
 */
export const MAX_DEBATE_EXCHANGES = 6;

export type DebateTurn = {
  order: number;
  speaker: string | null;
  answer: string | null;
};

function isAgent(turn: DebateTurn): boolean {
  return turn.speaker !== null && turn.speaker !== STUDENT_SPEAKER;
}

/** Completed rounds. A half-finished round does not count. */
export function exchangeCount(turns: DebateTurn[]): number {
  return Math.floor(turns.filter(isAgent).length / DEBATE_AGENTS.length);
}

export function canAdvance(turns: DebateTurn[]): boolean {
  return exchangeCount(turns) < MAX_DEBATE_EXCHANGES;
}

export function nextOrder(turns: DebateTurn[]): number {
  return turns.reduce((max, t) => Math.max(max, t.order), -1) + 1;
}

/** Agents alternate by their own count, so an interjection never costs one of them a turn. */
export function nextSpeaker(turns: DebateTurn[]): string {
  return DEBATE_AGENTS[turns.filter(isAgent).length % DEBATE_AGENTS.length];
}

/**
 * The interjection the agents have not yet spoken after. The student may
 * interject twice in a row; only the newest is owed a response, because the
 * older one is already in the transcript the next prompt sends.
 */
export function pendingInterjection(turns: DebateTurn[]): DebateTurn | null {
  const sorted = [...turns].sort((a, b) => a.order - b.order);
  const lastAgentOrder = sorted.filter(isAgent).reduce((max, t) => Math.max(max, t.order), -1);
  const after = sorted.filter((t) => t.speaker === STUDENT_SPEAKER && t.order > lastAgentOrder);
  return after.length > 0 ? after[after.length - 1] : null;
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/debate.ts src/lib/debate.test.ts
git commit -m "feat: add debate turn ordering, the exchange cap, and interjections"
```

---

### Task 5: Debate routes

**Files:**
- Create: `src/lib/prompts/debate.ts`,
  `src/app/api/interview/[id]/debate/advance/route.ts`,
  `src/app/api/interview/[id]/debate/interject/route.ts`
- Modify: `src/lib/validation.ts`

**Interfaces:**
- Consumes: `debate.ts` (Task 4); `searchCourse(folderId, query, k)` from `src/lib/embeddings.ts`,
  returning `{ chunkId, text, score, source, pageId, materialId, title }[]`;
  `reasoningModel()`, `callLLMJSON` from `src/lib/llm.ts`; `writeRecallSafely`;
  `interviewFeedbackResponseSchema` from `src/lib/interview.ts`.
- Produces: `POST /api/interview/[id]/debate/advance` → `{ turns, done, maxExchanges }`;
  `POST /api/interview/[id]/debate/interject` → `{ turn, feedback }` (or `{ turn, feedback: null, error }`);
  `debateInterjectSchema`, `debateUtteranceResponseSchema` in `src/lib/validation.ts`;
  `DEBATE_SYSTEM_PROMPT`, `buildDebateUtterancePrompt`, `INTERJECTION_GRADE_SYSTEM_PROMPT`,
  `buildInterjectionGradePrompt` in `src/lib/prompts/debate.ts`.

**Where an utterance is stored:** an agent turn keeps its text in `InterviewTurn.question` (a speaker
turn has no answer), and a student turn in `InterviewTurn.answer`. Both routes build a
`Map<order, string>` off that rule before prompting.

- [ ] **Step 1: Add the validation schemas**

Append to `src/lib/validation.ts`:

```ts
export const debateInterjectSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

/** One agent's utterance. Short by construction: a debate of essays is a reading task. */
export const debateUtteranceResponseSchema = z.object({
  utterance: z.string().trim().min(1).max(1500),
});
```

- [ ] **Step 2: Write the prompt module**

Create `src/lib/prompts/debate.ts`:

```ts
// Two agents argue one course concept, grounded in what the course actually
// captured. Judging two plausible arguments is a retrieval task disguised as a
// spectator sport — it surfaces exactly the distinctions notes gloss over.

import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";
import { DEBATE_AGENTS, type DebateTurn } from "@/lib/debate";

const BRIEFS: Record<string, string> = {
  [DEBATE_AGENTS[0]]:
    "You argue FOR the position under debate. You are confident, concrete, and you cite the course material by name when it supports you.",
  [DEBATE_AGENTS[1]]:
    "You argue AGAINST the position under debate. You look for the case the other side is glossing over: edge cases, assumptions, and places the course material is narrower than the claim.",
};

export const DEBATE_SYSTEM_PROMPT = `You are one voice in a two-sided academic debate held in front of a student. Speak in 2-4 sentences — this is a debate, not a lecture. Address the other side's last point directly rather than restating your own. Never break character, and never address the student unless they have just interjected.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{ "utterance": string }

${UNTRUSTED_CONTENT_CLAUSE}`;

export type DebateGrounding = { title: string; text: string }[];

function renderSources(grounding: DebateGrounding): string {
  return grounding
    .map((g, i) => `[${i + 1}] ${g.title}\n"""\n${g.text.slice(0, 1200)}\n"""`)
    .join("\n\n");
}

function renderTranscript(turns: DebateTurn[], texts: Map<number, string>): string {
  return [...turns]
    .sort((a, b) => a.order - b.order)
    .map((t) => `${t.speaker}: ${texts.get(t.order) ?? ""}`)
    .join("\n\n");
}

export function buildDebateUtterancePrompt(opts: {
  speaker: string;
  concept: string;
  persona: string | null;
  grounding: DebateGrounding;
  turns: DebateTurn[];
  texts: Map<number, string>;
  pending: DebateTurn | null;
}): string {
  const sources = renderSources(opts.grounding);

  return [
    `YOU ARE: ${opts.speaker}. ${BRIEFS[opts.speaker] ?? ""}`,
    opts.persona ? `THE BRIEF FOR THIS DEBATE: ${opts.persona}` : "",
    `THE POSITION UNDER DEBATE: "${opts.concept}"`,
    sources
      ? `WHAT THIS COURSE ACTUALLY SAYS (ground yourself here; do not invent sources):\n\n${sources}`
      : "This course has nothing indexed on the position yet. Argue from general knowledge and say so in one clause.",
    opts.turns.length > 0
      ? `THE DEBATE SO FAR:\n"""\n${renderTranscript(opts.turns, opts.texts)}\n"""`
      : "You are opening the debate.",
    opts.pending
      ? `THE STUDENT JUST INTERJECTED:\n"""\n${opts.pending.answer}\n"""\nAnswer their point first, in your own voice, then continue your argument.`
      : "",
    "Give your next utterance. Return the required JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const INTERJECTION_GRADE_SYSTEM_PROMPT = `You are marking a student who interrupted an academic debate to make a point. Grade whether their interjection is right about the material and whether it lands on the distinction actually at issue — not whether it is polite or well-written.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "strengths": [string, ...],       // 1-3 concrete things the interjection got right
  "improvements": [string, ...],    // 1-3 concrete corrections; the first is stored as the misconception when they score badly
  "score": number,                  // integer 1-5 (5 = decisive and correct, 1 = confused about the material)
  "modelAnswer": string             // the strongest version of the point they were reaching for
}

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildInterjectionGradePrompt(opts: {
  concept: string;
  grounding: DebateGrounding;
  turns: DebateTurn[];
  texts: Map<number, string>;
  interjection: string;
}): string {
  const sources = renderSources(opts.grounding);

  return [
    `THE POSITION UNDER DEBATE: "${opts.concept}"`,
    sources
      ? `WHAT THIS COURSE SAYS (the ground truth):\n\n${sources}`
      : "No course material was retrieved; judge against your own knowledge.",
    `THE DEBATE SO FAR:\n"""\n${renderTranscript(opts.turns, opts.texts)}\n"""`,
    `THE STUDENT'S INTERJECTION:\n"""\n${opts.interjection}\n"""`,
    "Grade the interjection and return the required JSON.",
  ].join("\n\n");
}
```

- [ ] **Step 3: Write the advance route**

Create `src/app/api/interview/[id]/debate/advance/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { searchCourse } from "@/lib/embeddings";
import {
  DEBATE_AGENTS,
  MAX_DEBATE_EXCHANGES,
  STUDENT_SPEAKER,
  canAdvance,
  nextOrder,
  nextSpeaker,
  pendingInterjection,
  type DebateTurn,
} from "@/lib/debate";
import { DEBATE_SYSTEM_PROMPT, buildDebateUtterancePrompt } from "@/lib/prompts/debate";
import { debateUtteranceResponseSchema } from "@/lib/validation";

/** How many course chunks ground one exchange. */
const GROUNDING_K = 6;

/**
 * One exchange: each agent speaks once, in order, both grounded in the same
 * retrieved chunks. Two completions per call on the free REASONING tier, capped
 * at six exchanges per session.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      topic: { select: { id: true, title: true, folderId: true } },
    },
  });
  if (!session) return jsonError("Interview session not found", 404);
  if (session.mode !== "DEBATE") return jsonError("This session is not a debate", 422);
  if (!session.topic) return jsonError("This debate has no course topic behind it", 422);

  const turns: DebateTurn[] = session.turns.map((t) => ({
    order: t.order,
    speaker: t.speaker,
    answer: t.answer,
  }));

  if (!canAdvance(turns)) {
    await db.interviewSession.update({ where: { id }, data: { status: "COMPLETED" } });
    return NextResponse.json({ turns: [], done: true, maxExchanges: MAX_DEBATE_EXCHANGES });
  }

  const grounding = (await searchCourse(session.topic.folderId, session.topic.title, GROUNDING_K)).map(
    (hit) => ({ title: hit.title, text: hit.text })
  );

  const texts = new Map<number, string>(
    session.turns.map((t) => [t.order, t.speaker === STUDENT_SPEAKER ? (t.answer ?? "") : t.question])
  );

  const created = [];
  const working = [...turns];
  const pending = pendingInterjection(working);

  for (let i = 0; i < DEBATE_AGENTS.length; i++) {
    const speaker = nextSpeaker(working);
    const order = nextOrder(working);

    let utterance: string;
    try {
      const raw = await callLLMJSON({
        model: reasoningModel(),
        systemPrompt: DEBATE_SYSTEM_PROMPT,
        userPrompt: buildDebateUtterancePrompt({
          speaker,
          concept: session.topic.title,
          persona: session.persona,
          grounding,
          turns: working,
          texts,
          // Only the first agent of the round answers the interjection; the
          // second is answering the first, which is the whole point of a debate.
          pending: i === 0 ? pending : null,
        }),
      });
      utterance = (await debateUtteranceResponseSchema.parseAsync(raw)).utterance;
    } catch (e) {
      // Half an exchange is still a readable transcript, so keep what landed
      // rather than rolling the round back.
      if (created.length > 0) break;
      const message =
        e instanceof ZodError
          ? "The model's response didn't match the expected format. You can retry this step."
          : e instanceof Error
            ? e.message
            : "The debate could not continue";
      return jsonError(message, 502);
    }

    const turn = await db.interviewTurn.create({
      data: { sessionId: id, order, question: utterance, speaker },
    });
    created.push(turn);
    working.push({ order, speaker, answer: null });
    texts.set(order, utterance);
  }

  const done = !canAdvance(working);
  if (done) {
    await db.interviewSession.update({ where: { id }, data: { status: "COMPLETED" } });
  }

  return NextResponse.json({ turns: created, done, maxExchanges: MAX_DEBATE_EXCHANGES });
}
```

- [ ] **Step 4: Write the interject route**

Create `src/app/api/interview/[id]/debate/interject/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { searchCourse } from "@/lib/embeddings";
import { STUDENT_SPEAKER, nextOrder, type DebateTurn } from "@/lib/debate";
import {
  INTERJECTION_GRADE_SYSTEM_PROMPT,
  buildInterjectionGradePrompt,
} from "@/lib/prompts/debate";
import { interviewFeedbackResponseSchema } from "@/lib/interview";
import { debateInterjectSchema } from "@/lib/validation";
import { writeRecallSafely } from "@/lib/recall-log";

const GROUNDING_K = 6;

/**
 * Watching a debate writes nothing; taking a side is the recall act. One event
 * per interjection, targeted at the course topic so the scheduler can see it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(debateInterjectSchema, body);
  if ("error" in result) return result.error;
  const { text } = result.data;

  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      topic: { select: { id: true, title: true, folderId: true } },
    },
  });
  if (!session) return jsonError("Interview session not found", 404);
  if (session.mode !== "DEBATE") return jsonError("This session is not a debate", 422);
  if (!session.topic) return jsonError("This debate has no course topic behind it", 422);

  const turns: DebateTurn[] = session.turns.map((t) => ({
    order: t.order,
    speaker: t.speaker,
    answer: t.answer,
  }));

  // The turn lands before the grade: a point the student typed is theirs whether
  // or not the grader is reachable.
  const turn = await db.interviewTurn.create({
    data: {
      sessionId: id,
      order: nextOrder(turns),
      question: "Interjection",
      answer: text,
      speaker: STUDENT_SPEAKER,
    },
  });

  const grounding = (await searchCourse(session.topic.folderId, session.topic.title, GROUNDING_K)).map(
    (hit) => ({ title: hit.title, text: hit.text })
  );

  const texts = new Map<number, string>(
    session.turns.map((t) => [t.order, t.speaker === STUDENT_SPEAKER ? (t.answer ?? "") : t.question])
  );

  let feedback;
  try {
    const raw = await callLLMJSON({
      model: reasoningModel(),
      systemPrompt: INTERJECTION_GRADE_SYSTEM_PROMPT,
      userPrompt: buildInterjectionGradePrompt({
        concept: session.topic.title,
        grounding,
        turns,
        texts,
        interjection: text,
      }),
    });
    feedback = await interviewFeedbackResponseSchema.parseAsync(raw);
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. Your point was kept; it just wasn't graded."
        : e instanceof Error
          ? e.message
          : "Your point was kept but could not be graded";
    return NextResponse.json({ turn, feedback: null, error: message });
  }

  await db.interviewTurn.update({
    where: { id: turn.id },
    data: { feedback: JSON.stringify(feedback) },
  });

  await writeRecallSafely({
    raw: { kind: "INTERVIEW", rating: feedback.score },
    topicId: session.topic.id,
    misconception: feedback.improvements[0] ?? null,
    detail: { interjection: text, score: feedback.score, mode: "DEBATE" },
  });

  return NextResponse.json({ turn, feedback });
}
```

- [ ] **Step 5: Typecheck, lint, test, commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add src/lib/prompts/debate.ts src/lib/validation.ts "src/app/api/interview/[id]/debate"
git commit -m "feat: run a two-agent debate the student can interrupt"
```

---

### Task 6: Debate UI

**Files:**
- Create: `src/components/interview/DebateRunner.tsx`
- Modify: `src/components/interview/InterviewRunner.tsx`, `src/app/interview/[id]/page.tsx`

**Interfaces:**
- Consumes: the two debate routes (Task 5); `DEBATE_AGENTS`, `MAX_DEBATE_EXCHANGES`,
  `STUDENT_SPEAKER`, `exchangeCount` from `src/lib/debate.ts`.
- Produces: `DebateRunner({ sessionId, concept, initialTurns, status })` where
  `initialTurns: { id: string; order: number; speaker: string | null; question: string; answer: string | null; feedback: string | null }[]`.

- [ ] **Step 1: Read the existing runner before writing anything**

```bash
sed -n '1,80p' src/components/interview/InterviewRunner.tsx
```

Match its state handling, error surfacing, and Tailwind conventions — this component is a sibling,
not a rewrite.

- [ ] **Step 2: Write `DebateRunner.tsx`**

A client component with:

- A transcript list. An agent turn renders `question` under its `speaker` name; a student turn renders
  `answer` under "You", visually distinct — `bg-daisy-soft/50` is the house treatment for "this is
  yours", used in `CourseOverview.tsx`.
- An **Advance** button posting to `/api/interview/${sessionId}/debate/advance`, appending the returned
  `turns`. Disabled while in flight and once `done` comes back true.
- An exchange counter reading `${exchangeCount(turns)} / ${MAX_DEBATE_EXCHANGES}`, computed with the
  imported helper rather than a second copy of the rule.
- An interject textarea + button posting to `/api/interview/${sessionId}/debate/interject`, appending
  the returned turn and rendering `feedback` inline when non-null. When the response carries
  `feedback: null` and an `error`, show that error beside the kept turn — the point was saved, only
  the grade failed.
- One `error` state rendered as `text-red-700`, matching `CourseOverview`.

- [ ] **Step 3: Branch the existing runner**

In `src/components/interview/InterviewRunner.tsx`, take `mode` as a prop and return
`<DebateRunner … />` when it is `"DEBATE"`, before any Q/A state is set up. `VIVA` and `PROTEGE` share
the existing render path — a protege session is the same question/answer/feedback loop with a
different voice, and giving it its own component would duplicate the whole runner for a prompt swap.

Pass `mode` and the concept (`session.topic?.title ?? session.title`) through from
`src/app/interview/[id]/page.tsx`.

- [ ] **Step 4: Verify by hand**

```bash
npm run dev
```

Create a debate (Task 11 adds the button; until then `POST /api/interview` with
`{"source":"COURSE_TOPIC","courseTopicId":"<id>","mode":"DEBATE"}`), advance twice, interject, advance
again. Confirm the interjection appears between the exchanges and the following exchange addresses it.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/interview src/app/interview
git commit -m "feat: watch a debate and interrupt it"
```

---

### Task 7: Lesson shape

**Files:**
- Create: `src/lib/lesson.ts`, `src/lib/lesson.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `LESSON_SCENES`; `type SceneKind`; `type LessonScene`;
  `lessonOutlineResponseSchema` (`{ beats: { title, focus }[] }`, 4-6);
  `lessonScenesResponseSchema` (`{ scenes: LessonScene[] }`, 4-6);
  `openOnRecall(scenes): LessonScene[]`; `dropUnbackedChecks(scenes, hasQuizQuestion): LessonScene[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/lesson.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dropUnbackedChecks,
  lessonOutlineResponseSchema,
  lessonScenesResponseSchema,
  openOnRecall,
  type LessonScene,
} from "./lesson.ts";

function scene(kind: LessonScene["kind"], title: string): LessonScene {
  return {
    kind,
    title,
    prompt: kind === "EXPLAIN" ? null : `prompt for ${title}`,
    body: kind === "EXPLAIN" ? "body" : null,
    citation: null,
  };
}

test("an outline of three beats is not a lesson", () => {
  const short = lessonOutlineResponseSchema.safeParse({
    beats: [
      { title: "a", focus: "x" },
      { title: "b", focus: "y" },
      { title: "c", focus: "z" },
    ],
  });
  assert.equal(short.success, false);
});

test("a malformed outline is rejected rather than half-read", () => {
  assert.equal(lessonOutlineResponseSchema.safeParse({ beats: "four of them" }).success, false);
  assert.equal(lessonOutlineResponseSchema.safeParse({}).success, false);
  assert.equal(
    lessonOutlineResponseSchema.safeParse({
      beats: [{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }],
    }).success,
    false
  );
});

test("a lesson never opens on EXPLAIN", () => {
  const scenes = [
    scene("EXPLAIN", "the notes"),
    scene("RECALL", "what do you remember"),
    scene("TEACH", "explain it"),
    scene("CHECK", "quiz"),
  ];
  const ordered = openOnRecall(scenes);
  assert.equal(ordered[0].kind, "RECALL");
  assert.equal(ordered.length, scenes.length);
  // Being asked first and told second is the whole point; every other beat keeps
  // its place.
  assert.deepEqual(
    ordered.map((s) => s.title),
    ["what do you remember", "the notes", "explain it", "quiz"]
  );
});

test("a lesson that already opens on RECALL is left alone", () => {
  const scenes = [scene("RECALL", "r"), scene("EXPLAIN", "e"), scene("TEACH", "t"), scene("CHECK", "c")];
  assert.deepEqual(openOnRecall(scenes), scenes);
});

test("a lesson with no RECALL beat at all is rejected", () => {
  assert.throws(() => openOnRecall([scene("EXPLAIN", "e"), scene("TEACH", "t")]), /RECALL/);
});

test("a CHECK with no question behind it is dropped, not invented", () => {
  const scenes = [scene("RECALL", "r"), scene("EXPLAIN", "e"), scene("CHECK", "c")];
  assert.deepEqual(
    dropUnbackedChecks(scenes, false).map((s) => s.kind),
    ["RECALL", "EXPLAIN"]
  );
  assert.deepEqual(
    dropUnbackedChecks(scenes, true).map((s) => s.kind),
    ["RECALL", "EXPLAIN", "CHECK"]
  );
});

test("the scene list is bounded at both ends", () => {
  const one = { kind: "RECALL", title: "t", prompt: "p", body: null, citation: null };
  assert.equal(lessonScenesResponseSchema.safeParse({ scenes: [one, one, one] }).success, false);
  assert.equal(
    lessonScenesResponseSchema.safeParse({ scenes: [one, one, one, one, one, one, one] }).success,
    false
  );
  assert.equal(lessonScenesResponseSchema.safeParse({ scenes: [one, one, one, one] }).success, true);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- --test-name-pattern="outline|EXPLAIN|RECALL|CHECK|scene list"
```

Expected: FAIL — `Cannot find module './lesson.ts'`.

- [ ] **Step 3: Implement**

Create `src/lib/lesson.ts`:

```ts
// A recitation lesson: an outline turned into scenes the app can actually
// render. Pure — the route owns the two completions and the retrieval.
//
// Lessons are not persisted. The scene list is generated per request and
// discarded; only the recall events the scenes produce survive, and those are
// the part with value.
// ponytail: ephemeral lessons; add a Lesson table the first time someone asks to
// resume one mid-way.

import { z } from "zod";

export const LESSON_SCENES = ["RECALL", "EXPLAIN", "TEACH", "CHECK"] as const;
export type SceneKind = (typeof LESSON_SCENES)[number];

export type LessonScene = {
  kind: SceneKind;
  title: string;
  /** The question put to the student. Null on EXPLAIN, which asks nothing. */
  prompt: string | null;
  /** The cited excerpt. Only EXPLAIN carries one. */
  body: string | null;
  /** Where the excerpt came from, for the citation line. */
  citation: string | null;
};

/** Stage one: the shape of the lesson, before any of it is written. */
export const lessonOutlineResponseSchema = z.object({
  beats: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        focus: z.string().trim().min(1).max(600),
      })
    )
    .min(4)
    .max(6),
});

export const lessonScenesResponseSchema = z.object({
  scenes: z
    .array(
      z.object({
        kind: z.enum(LESSON_SCENES),
        title: z.string().trim().min(1).max(200),
        prompt: z.string().trim().max(1000).nullable().default(null),
        body: z.string().trim().max(4000).nullable().default(null),
        citation: z.string().trim().max(300).nullable().default(null),
      })
    )
    .min(4)
    .max(6),
});

/**
 * A lesson always opens on RECALL and never on EXPLAIN. Being asked first and
 * told second is the whole point; a lesson that leads with the notes is a page
 * of notes with quizzes stapled on. The first RECALL beat is hoisted rather than
 * the list re-sorted, so the model's ordering survives everywhere else.
 */
export function openOnRecall(scenes: LessonScene[]): LessonScene[] {
  const i = scenes.findIndex((s) => s.kind === "RECALL");
  if (i < 0) throw new Error("A lesson needs at least one RECALL scene");
  if (i === 0) return scenes;
  return [scenes[i], ...scenes.slice(0, i), ...scenes.slice(i + 1)];
}

/**
 * A CHECK renders an *existing* quiz question. With none for this topic the beat
 * is dropped: generating one here would quietly make the lesson route a quiz
 * generator, with a second prompt to maintain and no way for the student to tell
 * which questions came from where.
 */
export function dropUnbackedChecks(scenes: LessonScene[], hasQuizQuestion: boolean): LessonScene[] {
  return hasQuizQuestion ? scenes : scenes.filter((s) => s.kind !== "CHECK");
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lesson.ts src/lib/lesson.test.ts
git commit -m "feat: add the recitation lesson shape and its ordering rule"
```

---

### Task 8: Lesson generation route

**Files:**
- Create: `src/lib/prompts/lesson.ts`,
  `src/app/api/folders/[id]/topics/[topicId]/lesson/route.ts`

**Interfaces:**
- Consumes: `lesson.ts` (Task 7); `searchCourse`; `reasoningModel()`, `callLLMJSON`.
- Produces: `POST /api/folders/[id]/topics/[topicId]/lesson` →
  `{ topic: { id, title }, pageId: string | null, scenes: LessonScene[],
  quizQuestion: { id, prompt, type, options, correctAnswer, explanation } | null }`;
  `LESSON_OUTLINE_SYSTEM_PROMPT`, `buildLessonOutlineUserPrompt`, `LESSON_SCENES_SYSTEM_PROMPT`,
  `buildLessonScenesUserPrompt` in `src/lib/prompts/lesson.ts`.

- [ ] **Step 1: Write the prompts**

Create `src/lib/prompts/lesson.ts` with the four exports above. Both system prompts end with
`UNTRUSTED_CONTENT_CLAUSE` and demand bare JSON, matching every other prompt module in
`src/lib/prompts/`.

`LESSON_OUTLINE_SYSTEM_PROMPT` asks for 4-6 beats as `{ "beats": [{ "title": string, "focus": string }] }`.

`buildLessonOutlineUserPrompt({ topicTitle, grounding })` renders the topic title and the retrieved
chunks the same way `buildDebateUtterancePrompt` does — numbered `[n] title` blocks in triple quotes.

`LESSON_SCENES_SYSTEM_PROMPT` must state the scene vocabulary explicitly, because the model has no
other way to know what the app can render:

```
Each beat becomes exactly one scene:
- "RECALL": a free-recall prompt. Set "prompt"; leave "body" null.
- "EXPLAIN": a short cited excerpt from the course material. Set "body" and "citation"; leave "prompt" null.
- "TEACH": ask the student to explain the beat to a confused classmate. Set "prompt"; leave "body" null.
- "CHECK": use the course's existing quiz question for this topic. Set "prompt" to a one-line lead-in; leave "body" null.

The lesson MUST open on a RECALL scene. Do not emit a CHECK scene when told there is no quiz question for this topic.
```

`buildLessonScenesUserPrompt({ topicTitle, beats, grounding, hasQuizQuestion })` renders the beats as a
numbered list and states plainly whether a quiz question exists.

- [ ] **Step 2: Write the route**

Create `src/app/api/folders/[id]/topics/[topicId]/lesson/route.ts`. Sequence:

1. Load the topic; 404 when it is missing or its `folderId` does not match `id`.
2. `const grounding = await searchCourse(id, topic.title, 8);`
3. Stage one: `callLLMJSON` on `reasoningModel()` with the outline prompt, parsed by
   `lessonOutlineResponseSchema`.
4. Find one existing quiz question behind the topic's best match:

```ts
const best = grounding[0] ?? null;
const quizQuestion =
  best && (best.pageId || best.materialId)
    ? await db.quizQuestion.findFirst({
        where: best.pageId ? { pageId: best.pageId } : { materialId: best.materialId as string },
        orderBy: { createdAt: "desc" },
      })
    : null;
```

5. Stage two: the scenes prompt with `hasQuizQuestion: quizQuestion !== null`, parsed by
   `lessonScenesResponseSchema`.
6. Order the result — dropping first, hoisting second:

```ts
const scenes = openOnRecall(dropUnbackedChecks(parsed.scenes, quizQuestion !== null));
```

Order matters: hoisting first and then dropping could leave a four-scene lesson at three, and
`openOnRecall` is the step that must see the final list.

7. Return `{ topic: { id: topic.id, title: topic.title }, pageId: best?.pageId ?? null, scenes, quizQuestion }`.
   Persist nothing.

Both stages reuse the `ZodError` → "The model's response didn't match the expected format. You can
retry this step." / 502 handling from `src/app/api/pages/[id]/blurt/route.ts`.

- [ ] **Step 3: Verify by hand against a real course**

```bash
npm run dev
curl -s -X POST http://localhost:3000/api/folders/<folderId>/topics/<topicId>/lesson \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.scenes.map(x=>x.kind));})'
```

Expected: 4-6 kinds, the first one `RECALL`, and no `CHECK` when the topic's source has no quiz
questions.

- [ ] **Step 4: Typecheck, lint, test, commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add src/lib/prompts/lesson.ts "src/app/api/folders/[id]/topics/[topicId]/lesson"
git commit -m "feat: generate a recitation lesson from a syllabus topic"
```

---

### Task 9: Lesson player

**Files:**
- Create: `src/components/course/LessonRunner.tsx`

**Interfaces:**
- Consumes: the lesson route (Task 8); `POST /api/pages/[id]/blurt`; the existing quiz answer route;
  `POST /api/interview` with `{ source: "COURSE_TOPIC", courseTopicId, mode: "PROTEGE" }`.
- Produces: `LessonRunner({ folderId, topicId, topicTitle })`.

- [ ] **Step 1: Build the player**

One scene on screen at a time, a **Next** that advances, and a progress line (`Scene 2 of 5`). Per
scene kind:

- `RECALL` — a textarea. On submit, `POST /api/pages/${pageId}/blurt` using the `pageId` the lesson
  route returned, so the write goes through the surface that already turns what was missed into cards.
  When `pageId` is null, show the prompt, accept the answer, and say plainly that it was not graded —
  inventing a second blurt path for a topic with no lecture behind it buys nothing.
- `EXPLAIN` — render `body` with `citation` beneath it. No interaction.
- `TEACH` — a button that creates a `PROTEGE` session on this topic and links to `/interview/<id>`.
  Scene position is component state and the exchange is a real session, so the student comes back to
  the lesson where they left it.
- `CHECK` — render the returned `quizQuestion` through the existing quiz answer flow.

- [ ] **Step 2: Verify by hand, and check the ledger**

Run a lesson end to end on a course that has a lecture.

```bash
npx tsx -e '
import { db } from "./src/lib/db.ts";
const rows = await db.reviewLog.findMany({ orderBy: { reviewedAt: "desc" }, take: 5,
  select: { kind: true, quality: true, topicId: true, pageId: true } });
console.log(rows);
'
```

Expected: a `BLURT` row from the recall scene, and a `FEYNMAN` row once the teach scene's session is
graded.

- [ ] **Step 3: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/course/LessonRunner.tsx
git commit -m "feat: play a recitation lesson scene by scene"
```

---

### Task 10: Pretests

**Files:**
- Create: `src/lib/prompts/pretest.ts`, `src/lib/pretest.test.ts`,
  `src/app/api/folders/[id]/topics/[topicId]/pretest/route.ts`,
  `src/app/api/folders/[id]/topics/[topicId]/pretest/submit/route.ts`,
  `src/components/course/PretestDialog.tsx`
- Modify: `src/lib/validation.ts`

**Interfaces:**
- Consumes: `writeRecallSafely`; `reasoningModel()`, `callLLMJSON`.
- Produces: `PRETEST_SYSTEM_PROMPT`, `buildPretestUserPrompt({ topicTitle, syllabusText })`;
  `pretestResponseSchema` (`{ questions: { prompt, options: string[4], correctIndex, explanation }[] }`, exactly 3);
  `pretestSubmitSchema` (the same three questions each plus `chosenIndex`);
  `POST …/pretest` → `{ topic, questions }`; `POST …/pretest/submit` → `{ held: number }`.

**Two deliberate narrowings:**

1. **Multiple choice, not short answer.** `normalizeQuality` already maps `{ kind: "PRETEST", correct }`
   (correct → 4, wrong → 0), so a chosen index grades itself with zero extra completions. A
   short-answer pretest would need a grading call per question for a signal that is never scheduled.
2. **The questions ride in `ReviewLog.detail`, not a new table.** One `PRETEST` row per question holds
   the prompt, the options, the correct index, the guess, and the explanation — exactly what the reveal
   renders. `// ponytail: pretest payloads ride in ReviewLog.detail; give them a table the first time
   something other than the reveal needs to query them.`

- [ ] **Step 1: Write the failing test**

Create `src/lib/pretest.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPretestUserPrompt } from "./prompts/pretest.ts";
import { pretestResponseSchema } from "./validation.ts";

test("the prompt is built from the topic and the syllabus", () => {
  const prompt = buildPretestUserPrompt({
    topicTitle: "Fourier transforms",
    syllabusText: "Week 3: Fourier transforms and the frequency domain.",
  });
  assert.match(prompt, /Fourier transforms/);
  assert.match(prompt, /Week 3/);
});

test("a pretest cannot see the lecture", () => {
  // The lecture has not been watched — that is what makes this a prediction.
  // The builder takes two fields and there is no third for a lecture to arrive
  // through, so a full call cannot produce the sections the other prompt
  // modules use to carry one.
  const prompt = buildPretestUserPrompt({
    topicTitle: "Fourier transforms",
    syllabusText: "Week 3: Fourier transforms.",
  });
  assert.equal(prompt.includes("LECTURE"), false);
  assert.equal(prompt.includes("TRANSCRIPT"), false);
  assert.equal(prompt.includes("NOTES"), false);
});

test("a pretest is exactly three questions with four options each", () => {
  const q = {
    prompt: "What does the transform map between?",
    options: ["a", "b", "c", "d"],
    correctIndex: 2,
    explanation: "because",
  };
  assert.equal(pretestResponseSchema.safeParse({ questions: [q, q, q] }).success, true);
  assert.equal(pretestResponseSchema.safeParse({ questions: [q, q] }).success, false);
  assert.equal(
    pretestResponseSchema.safeParse({ questions: [{ ...q, options: ["a", "b", "c"] }, q, q] }).success,
    false
  );
  assert.equal(
    pretestResponseSchema.safeParse({ questions: [{ ...q, correctIndex: 4 }, q, q] }).success,
    false
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- --test-name-pattern="pretest|topic and the syllabus"
```

Expected: FAIL — `Cannot find module './prompts/pretest.ts'`.

- [ ] **Step 3: Write the schemas**

Append to `src/lib/validation.ts`:

```ts
/**
 * Three prediction questions, built before the lecture exists. Multiple choice
 * so the guess grades itself: `normalizeQuality` maps a correct choice to 4 and
 * a wrong one to 0, and no second completion is needed for a signal the
 * scheduler never reads anyway.
 */
export const pretestResponseSchema = z.object({
  questions: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(600),
        options: z.array(z.string().trim().min(1).max(300)).length(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().trim().min(1).max(1000),
      })
    )
    .length(3),
});

export const pretestSubmitSchema = z.object({
  answers: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(600),
        options: z.array(z.string().trim().min(1).max(300)).length(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().trim().min(1).max(1000),
        chosenIndex: z.number().int().min(0).max(3),
      })
    )
    .length(3),
});

/** One held pretest question, as it comes back out of `ReviewLog.detail`. */
export const pretestDetailSchema = z.object({
  prompt: z.string(),
  options: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  chosenIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
});
```

- [ ] **Step 4: Write the prompt module**

Create `src/lib/prompts/pretest.ts`:

```ts
// Prediction questions asked BEFORE the lecture. Built from the topic title and
// the syllabus only — the lecture has not been watched, and a "pretest" that can
// see it is a quiz. The builder takes those two fields and nothing else, which
// is the guard: there is no parameter a lecture could arrive through.

import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

export const PRETEST_SYSTEM_PROMPT = `You write prediction questions for a student who is about to attend a lecture they have not yet seen. The student is expected to guess. A good question makes them commit to a belief about how something works, so that the lecture either confirms it or corrects it — guessing wrong is the point, not a failure.

Write exactly 3 questions. Each has 4 options, exactly one correct. Do not ask about definitions or terminology; ask about mechanisms, consequences, and trade-offs.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "questions": [
    {
      "prompt": string,
      "options": [string, string, string, string],
      "correctIndex": number,     // 0-3
      "explanation": string       // one or two sentences, shown only after the lecture is captured
    }
  ]
}

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildPretestUserPrompt(opts: { topicTitle: string; syllabusText: string }): string {
  return [
    `THE TOPIC THE STUDENT IS ABOUT TO STUDY: "${opts.topicTitle}"`,
    `WHAT THE SYLLABUS SAYS ABOUT THE COURSE:\n"""\n${opts.syllabusText.slice(0, 6000)}\n"""`,
    "Write the 3 prediction questions and return the required JSON.",
  ].join("\n\n");
}
```

- [ ] **Step 5: Run the tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Write the generate route**

`src/app/api/folders/[id]/topics/[topicId]/pretest/route.ts`:

1. Load the topic; 404 when missing or when its `folderId` does not match `id`.
2. Load the syllabus: `db.material.findFirst({ where: { folderId: id, kind: "SYLLABUS" } })`.
   With none, 422: `"This course has no syllabus to build a pretest from."`
3. One `callLLMJSON` on `reasoningModel()` with `PRETEST_SYSTEM_PROMPT` and
   `buildPretestUserPrompt({ topicTitle: topic.title, syllabusText: syllabus.text })`, parsed by
   `pretestResponseSchema`. Do not load the page, the notes, or the transcript anywhere in this file.
4. Return `{ topic: { id, title }, questions }`. Nothing is persisted — an unanswered pretest is not a
   recall event.

- [ ] **Step 7: Write the submit route**

`src/app/api/folders/[id]/topics/[topicId]/pretest/submit/route.ts`:

1. Validate with `pretestSubmitSchema`; 404 the topic the same way.
2. One event per question:

```ts
for (const a of result.data.answers) {
  await writeRecallSafely({
    raw: { kind: "PRETEST", correct: a.chosenIndex === a.correctIndex },
    topicId,
    detail: {
      prompt: a.prompt,
      options: a.options,
      correctIndex: a.correctIndex,
      chosenIndex: a.chosenIndex,
      explanation: a.explanation,
    },
  });
}
```

3. Return `{ held: result.data.answers.length }` and **no grades**. The answers are held until the
   lecture exists; returning them here would make the pretest a quiz.

- [ ] **Step 8: Write `PretestDialog.tsx`**

Three questions, radio options, one **Submit**. On success it says the answers are held and will be
revealed with the lecture's notes. It must not show which were right.

- [ ] **Step 9: Typecheck, lint, test, commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add src/lib/prompts/pretest.ts src/lib/pretest.test.ts src/lib/validation.ts \
  "src/app/api/folders/[id]/topics/[topicId]/pretest" src/components/course/PretestDialog.tsx
git commit -m "feat: guess a topic before the lecture exists"
```

---

### Task 11: The reveal, and the entry points

**Files:**
- Create: `src/components/page/PretestReveal.tsx`
- Modify: `src/components/course/CourseOverview.tsx`, `src/app/pages/[id]/page.tsx`

**Interfaces:**
- Consumes: `PretestDialog`, `LessonRunner` (Tasks 9-10); `pretestDetailSchema` (Task 10);
  `classifyTopic` / `coverageThreshold` from `src/lib/coverage.ts`; `TopicRow.covered`, which
  `src/app/folders/[folderId]/page.tsx:258-270` already computes.
- Produces: `PretestReveal({ entries })` where each entry is
  `{ topicTitle: string; prompt: string; options: string[]; correctIndex: number; chosenIndex: number; explanation: string }`.

- [ ] **Step 1: Reveal the held pretests on the lecture**

Coverage already yields `match.pageId` per topic, so no schema is needed. On
`src/app/pages/[id]/page.tsx`, score this page's folder topics the same way the course page does,
keep the topics whose best match is this page, then read their held rows:

```ts
const held = await db.reviewLog.findMany({
  where: { kind: "PRETEST", topicId: { in: coveredTopicIds } },
  orderBy: { reviewedAt: "asc" },
  select: { detail: true, topic: { select: { title: true } } },
});

const entries = held.flatMap((row) => {
  const parsed = pretestDetailSchema.safeParse(row.detail ? JSON.parse(row.detail) : null);
  return parsed.success ? [{ topicTitle: row.topic?.title ?? "This topic", ...parsed.data }] : [];
});
```

Parse rather than cast: `detail` is free-form JSON, and a row written by an older shape must skip,
not crash the lecture page.

`PretestReveal` renders one block per question — what they guessed, what was right, and the
explanation. This is the first time the student sees any of it. Render nothing when `entries` is empty.

- [ ] **Step 2: Add the topic-row buttons**

In `src/components/course/CourseOverview.tsx`, add to each topic `<li>`:

- **Pretest** when `!topic.covered` — opens `PretestDialog`. A topic with a lecture behind it is not a
  prediction any more.
- **Recite** when `topic.covered` — opens `LessonRunner`.

`TopicRow` needs no new field; `covered` already carries the distinction. Style both as secondary
buttons matching the existing `Topic` / `Parse syllabus` controls in the same file.

- [ ] **Step 3: Add the course-level Debate button**

In the `CourseOverview` header, beside `Parse syllabus`: a **Debate** button, enabled only when
`topics.length > 0`. It opens a `<select>` over `topics`, then `POST`s `/api/interview` with
`{ source: "COURSE_TOPIC", courseTopicId, mode: "DEBATE" }` and routes to `/interview/<id>` via the
`useRouter` already imported in that file.

- [ ] **Step 4: Add "Teach it back" to the lecture**

On `src/app/pages/[id]/page.tsx`, beside the existing study actions: a button that `POST`s
`/api/interview` with `{ source: "LECTURE", pageId, title, mode: "PROTEGE" }` and routes to the
session.

- [ ] **Step 5: Verify by hand**

Pretest an uncovered topic, import a lecture that covers it, then open that lecture and confirm the
held answers appear with the notes. Recite a covered topic. Start a debate from the header. Teach a
lecture back.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add src/components src/app/pages
git commit -m "feat: start study from the coverage dashboard, and reveal pretests with the notes"
```

---

### Task 12: Verification

**Files:** none created; this task runs things and records what they said.

- [ ] **Step 1: The full suite and the compilers**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

Expected: all green. Record the test count — the 111 that existed plus the tests added by Tasks 2, 4,
7, and 10.

- [ ] **Step 2: Confirm the ledger still has one writer**

```bash
grep -rn "reviewLog.create" src/ | grep -v "src/lib/recall-log.ts"
```

Expected: no output. Anything printed is a Phase 6 route that bypassed `writeRecall`.

- [ ] **Step 3: Confirm pretests are recorded, targeted, and never scheduled**

```bash
npx tsx -e '
import { db } from "./src/lib/db.ts";
import { isSchedulable } from "./src/lib/recall.ts";
const rows = await db.reviewLog.findMany({ where: { kind: "PRETEST" }, select: { id: true, topicId: true } });
console.log("pretest rows:", rows.length, "schedulable:", isSchedulable("PRETEST"));
const orphans = rows.filter((r) => !r.topicId);
if (orphans.length) { console.error("pretest rows with no topic:", orphans.length); process.exit(1); }
'
```

Expected: a non-zero row count, `schedulable: false`, and no orphans.

- [ ] **Step 4: Confirm pre-Phase-6 sessions are untouched**

Open an interview session created before this branch. It runs as `VIVA`, its turns have
`speaker: null`, and the question/answer/feedback loop behaves exactly as before.

- [ ] **Step 5: End to end against a real course**

1. Pretest an uncovered topic; import a lecture covering it; confirm the reveal appears with the notes.
2. Teach that lecture back in `PROTEGE`; confirm the ledger gains a `FEYNMAN` row with `pageId` set.
3. Debate that topic; interject once; confirm the ledger gains an `INTERVIEW` row with `topicId` set,
   and that the next exchange addresses the interjection.
4. Recite the topic; confirm the lesson opens on a recall prompt and never on an excerpt.
5. Advance a debate to the cap; confirm it stops at six exchanges and the session reads `COMPLETED`.

- [ ] **Step 6: Confirm the snapshot still exists**

```bash
ls -1t prisma/backups | head -3
```

The pre-migration snapshot from Task 1 must still be there. It is the only rollback for the schema
change this branch made.

---

## Out of scope

- A `Lesson` table. Lessons stay ephemeral until someone asks to resume one mid-way.
- Generating a quiz question for an unbacked `CHECK` scene. The beat is dropped instead.
- A third debate agent, or per-session personas the user edits. Two fixed briefs plus the free-text
  `persona` column is the whole surface.
- Short-answer pretests, and any grading of a pretest beyond the chosen index.
- Whiteboard drawing, TTS, 3D scenes, project-based-learning roles — the parts of OpenMAIC that do not
  survive contact with a single-user local notetaker (§17).
- Touching `isSchedulable`, `normalizeQuality`, or `RECALL_LEDGER_SINCE`. Phase 5's scale is the scale.
