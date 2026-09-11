import { test } from "node:test";
import assert from "node:assert/strict";
import { parsedEventSchema, parsedEventsEnvelopeSchema, buildParseEventsSystemPrompt } from "./calendar-schema.ts";

const courses = ["Thermodynamics", "Linear Algebra"];

test("a classified, matched event parses", () => {
  const out = parsedEventSchema(courses).parse({
    title: "Midterm",
    start: "2026-09-15T13:00",
    kind: "EXAM",
    course: "Thermodynamics",
  });
  assert.equal(out.kind, "EXAM");
  assert.equal(out.course, "Thermodynamics");
});

test("kind defaults to OTHER and course to null when the model omits them", () => {
  const out = parsedEventSchema(courses).parse({ title: "Dentist", start: "2026-09-16T09:00" });
  assert.equal(out.kind, "OTHER");
  assert.equal(out.course, null);
});

test("a kind outside the enum is rejected", () => {
  const r = parsedEventSchema(courses).safeParse({ title: "x", start: "2026-09-16", kind: "PARTY" });
  assert.equal(r.success, false);
});

test("a course outside the offered list is rejected", () => {
  const r = parsedEventSchema(courses).safeParse({ title: "x", start: "2026-09-16", course: "Chemistry" });
  assert.equal(r.success, false);
});

test("the envelope accepts unknown events so one bad row cannot sink the sync", () => {
  const r = parsedEventsEnvelopeSchema.safeParse({ events: [{ junk: true }, 42] });
  assert.equal(r.success, true);
});

test("the envelope caps the batch", () => {
  const r = parsedEventsEnvelopeSchema.safeParse({ events: new Array(51).fill({}) });
  assert.equal(r.success, false);
});

test("the prompt names every course and the kinds", () => {
  const p = buildParseEventsSystemPrompt(courses);
  assert.match(p, /Thermodynamics/);
  assert.match(p, /Linear Algebra/);
  assert.match(p, /EXAM/);
  assert.match(p, /ASSIGNMENT/);
  assert.match(p, /CLASS/);
});
