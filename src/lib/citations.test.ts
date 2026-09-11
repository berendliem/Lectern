import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeCitations, formatCitation, slideNumberFromChunk } from "./citations.ts";

test("slideNumberFromChunk reads the slide prefix the pptx extractor writes", () => {
  assert.equal(slideNumberFromChunk("Slide 8: Calvin cycle\nThe dark reactions…"), 8);
});

test("slideNumberFromChunk finds the first slide in a chunk spanning several", () => {
  assert.equal(slideNumberFromChunk("Slide 11: intro\nSlide 12: detail"), 11);
});

test("slideNumberFromChunk returns null for text with no slide prefix", () => {
  assert.equal(slideNumberFromChunk("The mitochondrion is the site of…"), null);
});

test("slideNumberFromChunk ignores the word slide used in prose", () => {
  assert.equal(slideNumberFromChunk("as shown on the slide before this one"), null);
});

test("formatCitation labels a lecture chunk with just the lecture title", () => {
  const out = formatCitation({
    title: "Photosynthesis",
    text: "Light reactions happen in the thylakoid…",
    pageId: "p1",
    materialId: null,
  });
  assert.deepEqual(out, { label: "Photosynthesis", pageId: "p1", materialId: null });
});

test("formatCitation appends the slide number for a slide-deck chunk", () => {
  const out = formatCitation({
    title: "Week 2 slides",
    text: "Slide 8: Calvin cycle",
    pageId: null,
    materialId: "m1",
  });
  assert.deepEqual(out, { label: "Week 2 slides · Slide 8", pageId: null, materialId: "m1" });
});

test("formatCitation leaves a non-slide material with just its title", () => {
  const out = formatCitation({
    title: "Course syllabus",
    text: "Week 3 covers enzyme kinetics.",
    pageId: null,
    materialId: "m2",
  });
  assert.deepEqual(out, { label: "Course syllabus", pageId: null, materialId: "m2" });
});

test("dedupeCitations collapses several chunks from one lecture to a single citation", () => {
  const out = dedupeCitations([
    { label: "Photosynthesis", pageId: "p1", materialId: null },
    { label: "Photosynthesis", pageId: "p1", materialId: null },
    { label: "Photosynthesis · Slide 2", pageId: "p1", materialId: null },
  ]);
  assert.deepEqual(out, [{ label: "Photosynthesis", pageId: "p1", materialId: null }]);
});

test("dedupeCitations keeps two materials that share a title, keyed on id not label", () => {
  const out = dedupeCitations([
    { label: "Syllabus", pageId: null, materialId: "m1" },
    { label: "Syllabus", pageId: null, materialId: "m2" },
  ]);
  assert.deepEqual(out, [
    { label: "Syllabus", pageId: null, materialId: "m1" },
    { label: "Syllabus", pageId: null, materialId: "m2" },
  ]);
});
