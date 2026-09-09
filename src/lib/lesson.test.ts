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
