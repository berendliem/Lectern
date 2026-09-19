import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOnqCourses, parseOnqDueItems, parseOnqModules, parseOnqTopicText } from "./onq-parse.ts";

test("reads courses and drops fields Lectern does not use", () => {
  const out = parseOnqCourses([{ course_id: 100001, name: "CISC 102", code: "X", active: true }]);
  assert.deepEqual(out, [{ courseId: 100001, name: "CISC 102" }]);
});

test("reads a module tree", () => {
  const out = parseOnqModules([
    {
      module_id: 100,
      title: "Unit 1",
      topics: [
        {
          topic_id: 200,
          title: "Slides",
          type: "File",
          extension: "pptx",
          downloadable: true,
          last_modified: "2026-09-08T14:02:11.000Z",
          source_file_name: "w1.pptx",
        },
      ],
    },
  ]);
  assert.deepEqual(out, [
    {
      moduleId: 100,
      title: "Unit 1",
      topics: [
        { topicId: 200, title: "Slides", extension: "pptx", downloadable: true, lastModified: "2026-09-08T14:02:11.000Z" },
      ],
    },
  ]);
});

test("an older onq-mcp without the new fields reads as nothing downloadable", () => {
  // Before onq-mcp learned `downloadable`, topics carried only id/title/type/
  // extension. Greyed-out rows are a clearer failure than a crash.
  const out = parseOnqModules([{ module_id: 1, title: "U", topics: [{ topic_id: 2, title: "T", extension: null }] }]);
  assert.deepEqual(out[0].topics[0], {
    topicId: 2,
    title: "T",
    extension: null,
    downloadable: false,
    lastModified: null,
  });
});

test("a null title becomes a label rather than failing the whole tree", () => {
  const out = parseOnqModules([{ module_id: 1, title: null, topics: [{ topic_id: 2, title: null }] }]);
  assert.equal(out[0].title, "Untitled");
  assert.equal(out[0].topics[0].title, "Untitled");
});

test("reads a topic's text", () => {
  const out = parseOnqTopicText({
    topic_id: 200,
    title: "Slides",
    extension: "pptx",
    downloadable: true,
    last_modified: "2026-09-08T14:02:11.000Z",
    source_file_name: "w1.pptx",
    text: "# Week 1",
    cached: false,
  });
  assert.equal(out.text, "# Week 1");
  assert.equal(out.sourceFileName, "w1.pptx");
  assert.equal(out.note, null);
});

test("a topic that could not be read keeps its note", () => {
  const out = parseOnqTopicText({
    topic_id: 9,
    title: "Site",
    text: null,
    link: "https://example.edu/",
    note: "Not a downloadable file; open the link directly.",
  });
  assert.equal(out.text, null);
  assert.equal(out.note, "Not a downloadable file; open the link directly.");
});

test("names the tool when the shape is wrong", () => {
  assert.throws(() => parseOnqModules({ nope: true }), /course_content/);
  assert.throws(() => parseOnqCourses("x"), /list_courses/);
  assert.throws(() => parseOnqTopicText([]), /read_topic/);
});

test("rejects over-long strings, naming the tool", () => {
  const withTopic = (topic: Record<string, unknown>) => [{ module_id: 1, title: "U", topics: [{ topic_id: 2, ...topic }] }];
  assert.throws(() => parseOnqModules(withTopic({ title: "t".repeat(301) })), /course_content/);
  assert.throws(() => parseOnqModules(withTopic({ title: "T", extension: "e".repeat(301) })), /course_content/);
  assert.throws(() => parseOnqModules(withTopic({ title: "T", last_modified: "d".repeat(65) })), /course_content/);
  const read = (over: Record<string, unknown>) => ({ topic_id: 2, title: "T", text: "x", ...over });
  assert.throws(() => parseOnqTopicText(read({ note: "n".repeat(2001) })), /read_topic/);
  assert.throws(() => parseOnqTopicText(read({ source_file_name: "f".repeat(301) })), /read_topic/);
  assert.equal(parseOnqTopicText(read({ note: "n".repeat(2000), source_file_name: "f".repeat(300) })).text, "x");
});

test("reads due items, turning the due date into a Date", () => {
  const out = parseOnqDueItems([
    {
      course: "CISC 102",
      kind: "quiz",
      id: 9,
      name: "Quiz #1",
      due: "2026-09-23T01:00:00+00:00",
      completed: null,
      overdue: false,
    },
  ]);
  assert.deepEqual(out, [
    {
      course: "CISC 102",
      kind: "quiz",
      id: 9,
      name: "Quiz #1",
      due: new Date("2026-09-23T01:00:00Z"),
      completed: null,
      overdue: false,
    },
  ]);
});

test("an older onq-mcp without completed/overdue reads as unknown and not overdue", () => {
  const out = parseOnqDueItems([
    { course: "X", kind: "assignment", id: 1, name: "HW", due: "2026-09-23T01:00:00+00:00", submission_status: "n/a" },
  ]);
  assert.equal(out[0].completed, null);
  assert.equal(out[0].overdue, false);
});

test("a due date that is not a date fails with the update-onq-mcp message", () => {
  assert.throws(
    () => parseOnqDueItems([{ course: "X", kind: "quiz", id: 1, name: "Q", due: "soon" }]),
    /whats_due returned a shape/
  );
});
