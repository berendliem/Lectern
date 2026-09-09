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
