# Lectern Phase 3 — Syllabus intelligence and rebrand

**Goal:** A course knows what its syllabus says it covers, shows which of those topics no lecture stands behind, gives every AI feature an entry point at the tier where it has context, and the app is called Lectern.

**Architecture:** A `CourseTopic` row per syllabus topic, written by a reasoning-model parse of the course's syllabus material and hand-editable afterwards. Coverage reuses the Phase 2 chunk corpus: every topic title is embedded once, scored by cosine against that course's chunks, and the best hit above `COVERAGE_THRESHOLD` names the lecture or material that covers it. Classification and the mastery roll-up are pure functions in `coverage.ts`; the embedding and the database reads stay in `embeddings.ts`.

**Spec:** `docs/superpowers/specs/2026-08-28-lectern-course-library-design.md` — §5 data model, §8 model tiers, §11 information architecture, §13 Phase 3.

## Global constraints

- Additive schema. `Folder`/`Page` model names stay; the UI says course and lecture.
- Coverage is a hint, never a claim that a topic was not taught. The threshold is an env knob.
- Topics stay editable by hand: a badly formatted syllabus must never leave a course stuck with garbage topics.
- Only new course-scoped work uses the REASONING tier; every existing per-lecture route keeps its model.
- Tests are `node --test` + `node:assert/strict` under `src/lib/**/*.test.ts`, relative imports, no database and no network.
- Run `npm test`, `npx tsc --noEmit`, and `npm run lint` before each commit.

## Tasks

### Task 1 — `CourseTopic`, syllabus parsing, hand editing
- `CourseTopic` model and migration; `topics` relation on `Folder`.
- `src/lib/prompts/syllabus.ts` — system prompt and user prompt builder.
- `syllabusTopicsResponseSchema` in `validation.ts`, plus create/update schemas for hand edits.
- `POST /api/folders/[id]/parse-syllabus` — reasoning tier, Zod-validated, replaces that course's topics.
- `POST /api/folders/[id]/topics`, `PATCH|DELETE /api/topics/[id]`.

### Task 2 — Coverage
- `src/lib/coverage.ts` (pure): `coverageThreshold()`, `classifyTopic()`, `rollUpMastery()`.
- `src/lib/coverage.test.ts`: threshold boundary, no-hit case, mastery roll-up.
- `scoreTopics(folderId, titles)` in `embeddings.ts`: one embed pass, best chunk per topic.

### Task 3 — Course overview tab
- `CourseOverview` server-rendered content plus a client `TopicList` for add/edit/delete and the parse button.
- Overview becomes the course page's first tab; the page also carries Ask, Review, Cram, Interview, and Feynman entry points.

### Task 4 — Lecture entry points
- `/feynman?pageId=` pre-seeds the concept suggestions from the lecture's key terms and the notes as the reference answer.
- `/focus?pageId=` binds the timer to a lecture.
- `/dictionary?pageId=` offers that lecture's key terms as one-click additions.
- Schedule review accepts a `pageId` so a lecture's own due cards can be booked.
- A `LectureActions` row on the lecture page links all four.

### Task 5 — Rebrand
- Wordmark, page titles, `package.json` name, README, and the user-facing strings that still say Notetaker.

## Deliberate omissions

- No `FocusSession` table. The timer is bound to a lecture in the UI; nothing reads a persisted session yet, and the planner streak is `ReviewLog`-derived.
- No per-topic flashcards. Topics describe what a course covers; cards still hang from a lecture or a material.
