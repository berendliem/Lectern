import { test } from "node:test";
import assert from "node:assert/strict";
import { routeDropFile, titleFromPath } from "./drop-intake.ts";

test("office and pdf files become materials, transcripts become lectures", () => {
  assert.deepEqual(routeDropFile("Week 3 deck.pptx"), {
    dest: "material",
    extract: "pptx",
    kind: "SLIDES",
  });
  assert.deepEqual(routeDropFile("notes/chapter1.pdf"), {
    dest: "material",
    extract: "pdf",
    kind: "READING",
  });
  assert.deepEqual(routeDropFile("handout.docx"), {
    dest: "material",
    extract: "docx",
    kind: "READING",
  });
  assert.equal(routeDropFile("Lecture 2.vtt").dest, "lecture");
  assert.equal(routeDropFile("Lecture 2.srt").dest, "lecture");
  assert.equal(routeDropFile("otter export.txt").dest, "lecture");
});

const kindOf = (path: string) => {
  const route = routeDropFile(path);
  return route.dest === "material" ? route.kind : null;
};

test("a syllabus named .txt is a material, not a transcript", () => {
  // The extension alone would send it to the transcript parser, which rejects
  // it for having no timestamps — and the modal cannot re-route a row.
  assert.deepEqual(routeDropFile("MATH 112 syllabus.txt"), {
    dest: "material",
    extract: "txt",
    kind: "SYLLABUS",
  });
  assert.equal(routeDropFile("otter export.txt").dest, "lecture");
});

test("a syllabus is recognised by name, whatever its extension", () => {
  // Kind is not cosmetic: syllabus chunks are excluded from coverage scoring,
  // so a syllabus filed as READING would credit the syllabus for covering
  // itself, and one filed the other way loses a real material.
  assert.equal(kindOf("MATH 112 Syllabus.pdf"), "SYLLABUS");
  assert.equal(kindOf("course outline f26.docx"), "SYLLABUS");
  assert.equal(kindOf("Fall/CISC102 syllabus.pptx"), "SYLLABUS");
});

test("archive junk and unreadable files are skipped with a reason", () => {
  for (const path of [
    "__MACOSX/._deck.pptx",
    "__macosx/._deck.pptx",
    ".DS_Store",
    "notes/.hidden.pdf",
    "week1/",
  ]) {
    assert.equal(routeDropFile(path).dest, "skip", path);
  }
  const zip = routeDropFile("inner.zip");
  assert.equal(zip.dest, "skip");
  assert.match(zip.dest === "skip" ? zip.reason : "", /zip/i);
  assert.equal(routeDropFile("lecture.mp4").dest, "skip");
  // Dropping a recording is a fair guess, so the reason says where audio goes
  // instead of implying the file is unreadable.
  const audio = routeDropFile("Lecture 4.m4a");
  assert.equal(audio.dest, "skip");
  assert.match(audio.dest === "skip" ? audio.reason : "", /lecture page/);
  assert.equal(routeDropFile("README").dest, "skip");
});

test("titles drop the folders and the extension, and never come back empty", () => {
  assert.equal(titleFromPath("Fall 2026/Week 3/deck.pptx"), "deck");
  assert.equal(titleFromPath("chapter1.pdf"), "chapter1");
  assert.equal(titleFromPath(".pdf"), "Untitled");
});
