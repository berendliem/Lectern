import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotateTree,
  bestCourseMatch,
  defaultSelection,
  guessKind,
  isSessionError,
  materialFromTopic,
  runImport,
  selectAllState,
  setDefaults,
  type ImportOutcome,
  type ImportTarget,
} from "./onq-import.ts";
import type { OnqModule, OnqTopicText } from "./mcp/onq-parse.ts";

const topic = (topicId: number, over: Partial<OnqModule["topics"][number]> = {}) => ({
  topicId,
  title: `Topic ${topicId}`,
  extension: "pdf",
  downloadable: true,
  lastModified: "2026-09-01T00:00:00.000Z",
  ...over,
});

test("guesses slides from the extension", () => {
  assert.equal(guessKind("pptx", "Week 2", "Unit 1"), "SLIDES");
  assert.equal(guessKind("key", "Week 2", "Unit 1"), "SLIDES");
});

test("guesses a syllabus from either title, ahead of the extension", () => {
  assert.equal(guessKind("pdf", "CISC102 Course Syllabus", "Start here"), "SYLLABUS");
  assert.equal(guessKind("pdf", "F26 outline", "Course Outline"), "SYLLABUS");
  assert.equal(guessKind("pptx", "Syllabus walkthrough", "Week 1"), "SYLLABUS");
});

test("everything else is a reading", () => {
  assert.equal(guessKind("pdf", "Chapter 3", "Unit 1"), "READING");
  assert.equal(guessKind(null, "Chapter 3", "Unit 1"), "READING");
});

test("annotates each topic against what is already imported", () => {
  const modules: OnqModule[] = [
    {
      moduleId: 1,
      title: "Unit 1",
      topics: [
        topic(10),
        topic(11),
        topic(12, { lastModified: "2026-10-01T00:00:00.000Z" }),
        topic(13, { downloadable: false, extension: null }),
      ],
    },
  ];
  const out = annotateTree(modules, [
    { onqTopicId: 11, onqLastModified: "2026-09-01T00:00:00.000Z" },
    { onqTopicId: 12, onqLastModified: "2026-09-01T00:00:00.000Z" },
    { onqTopicId: null, onqLastModified: null },
  ]);
  assert.deepEqual(
    out[0].topics.map((t) => [t.topicId, t.status]),
    [
      [10, "new"],
      [11, "imported"],
      [12, "changed"],
      [13, "unavailable"],
    ]
  );
});

test("an imported topic onQ gives no date for is not reported as changed", () => {
  const out = annotateTree(
    [{ moduleId: 1, title: "U", topics: [topic(10, { lastModified: null })] }],
    [{ onqTopicId: 10, onqLastModified: "2026-09-01T00:00:00.000Z" }]
  );
  assert.equal(out[0].topics[0].status, "imported");
});

test("pre-ticks what is new or changed, nothing else", () => {
  const annotated = annotateTree(
    [{ moduleId: 1, title: "U", topics: [topic(10), topic(11), topic(13, { downloadable: false })] }],
    [{ onqTopicId: 11, onqLastModified: "2026-09-01T00:00:00.000Z" }]
  );
  assert.deepEqual(defaultSelection(annotated), [10]);
});

test("the select-all box reads the pre-ticked set, not everything ticked", () => {
  const defaults = [10, 12];
  assert.equal(selectAllState(new Set([10, 12]), defaults), "all");
  assert.equal(selectAllState(new Set([10, 12, 11]), defaults), "all");
  assert.equal(selectAllState(new Set([12]), defaults), "some");
  assert.equal(selectAllState(new Set(), defaults), "none");
  // Re-ticking an already-imported file alone is not "some of the new ones".
  assert.equal(selectAllState(new Set([11]), defaults), "none");
});

test("the select-all box adds and removes only the pre-ticked set", () => {
  const defaults = [10, 12];
  assert.deepEqual([...setDefaults(new Set([11]), defaults, true)].sort(), [10, 11, 12]);
  // Unticking leaves a hand-ticked re-import alone: the box never showed it.
  assert.deepEqual([...setDefaults(new Set([10, 11, 12]), defaults, false)], [11]);
  assert.deepEqual([...setDefaults(new Set([10, 12]), defaults, false)], []);
});

test("matches a Lectern course to an onQ course by its number", () => {
  const courses = [
    { courseId: 1, name: "CISC121 Introduction to Computing Science I F26" },
    { courseId: 2, name: "CISC102 Discrete Mathematics for Computing I F26" },
    { courseId: 3, name: "MATH112 Introduction to Linear Algebra F26" },
  ];
  assert.equal(bestCourseMatch("CISC 102 Discrete Math Fall", courses), 2);
  assert.equal(bestCourseMatch("Math 112 Linear Algebra Fall", courses), 3);
});

test("does not guess a course when no number is shared", () => {
  const courses = [{ courseId: 1, name: "CISC121 Introduction to Computing Science I F26" }];
  assert.equal(bestCourseMatch("Introduction to Philosophy", courses), null);
  assert.equal(bestCourseMatch("Phil 111", courses), null);
});

const read = (over: Partial<OnqTopicText> = {}): OnqTopicText => ({
  ...topic(10),
  text: "# Week 1\nbody",
  note: null,
  sourceFileName: "w1.pdf",
  ...over,
});

test("drafts a material from a read topic", () => {
  assert.deepEqual(materialFromTopic(read(), "Unit 1", 1000), {
    draft: {
      kind: "READING",
      title: "Topic 10",
      text: "# Week 1\nbody",
      sourceFileName: "w1.pdf",
      onqTopicId: 10,
      onqLastModified: "2026-09-01T00:00:00.000Z",
    },
  });
});

test("skips a topic with no text, giving onq-mcp's own reason", () => {
  assert.deepEqual(materialFromTopic(read({ text: null, note: "Could not extract text (…)." }), "U", 1000), {
    skip: "Could not extract text (…).",
  });
  assert.deepEqual(materialFromTopic(read({ text: "   ", note: null }), "U", 1000), {
    skip: "onQ returned no readable text for this file.",
  });
});

test("skips rather than truncates a topic over the limit", () => {
  const out = materialFromTopic(read({ text: "x".repeat(11) }), "U", 10);
  assert.ok("skip" in out);
  assert.match(out.skip, /too long/);
});

test("recognises onq-mcp's session messages", () => {
  assert.equal(isSessionError("onQ session expired — open https://onq.queensu.ca/ in Brave, log in, then retry."), true);
  assert.equal(isSessionError("No onq.queensu.ca session found (missing d2lSessionVal). Log in at …"), true);
  assert.equal(isSessionError("Request timed out"), false);
});

const targets: ImportTarget[] = [
  { topicId: 1, title: "A", moduleTitle: "U" },
  { topicId: 2, title: "B", moduleTitle: "U" },
  { topicId: 3, title: "C", moduleTitle: "U" },
];

test("tallies outcomes and keeps going past one bad file", async () => {
  const steps: string[] = [];
  const summary = await runImport(
    targets,
    async (t) => {
      if (t.topicId === 1) return { outcome: "imported" };
      if (t.topicId === 2) throw new Error("Request timed out");
      return { outcome: "skipped", reason: "no text" };
    },
    (s) => steps.push(s)
  );
  assert.deepEqual(summary, {
    imported: 1,
    updated: 0,
    skipped: [
      { topicId: 2, title: "B", reason: "Request timed out" },
      { topicId: 3, title: "C", reason: "no text" },
    ],
    aborted: null,
  });
  assert.equal(steps.length, 3);
});

test("stops at a dead session: every later file would fail the same way", async () => {
  const seen: number[] = [];
  const summary = await runImport(
    targets,
    async (t) => {
      seen.push(t.topicId);
      if (t.topicId === 2) throw new Error("onQ session expired — open … log in, then retry.");
      return { outcome: "updated" };
    },
    () => undefined
  );
  assert.deepEqual(seen, [1, 2]);
  assert.equal(summary.updated, 1);
  assert.match(summary.aborted ?? "", /session expired/);
});

test("does not guess between two sections of one course", () => {
  const courses = [
    { courseId: 1, name: "CISC102 Discrete Mathematics section 001 F26" },
    { courseId: 2, name: "CISC102 Discrete Mathematics section 002 F26" },
  ];
  assert.equal(bestCourseMatch("CISC 102 Discrete Mathematics", courses), null);
});

test("a year is not a course number", () => {
  const courses = [{ courseId: 1, name: "PHIL 111 Introduction to Philosophy 2026" }];
  assert.equal(bestCourseMatch("Ethics 2026", courses), null);
  assert.equal(bestCourseMatch("PHIL 111 2026", courses), 1);
});

test("an outcome it does not know is a skip, not a crash", async () => {
  const summary = await runImport(
    targets.slice(0, 1),
    async () => ({ outcome: "done" }) as unknown as ImportOutcome,
    () => undefined
  );
  assert.deepEqual(summary, {
    imported: 0,
    updated: 0,
    skipped: [{ topicId: 1, title: "A", reason: "Lectern returned an unexpected result." }],
    aborted: null,
  });
});
