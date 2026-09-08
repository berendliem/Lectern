import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { expandZips, type ZipLimits } from "./drop-files.ts";

const LIMITS: ZipLimits = { entryBytes: 1024, totalBytes: 4096, entries: 3 };

function zipFile(name: string, contents: Record<string, Uint8Array>) {
  return { path: name, file: new File([zipSync(contents)], name) };
}

const text = (s: string) => strToU8(s);

test("a dropped zip is replaced by the files inside it, paths intact", async () => {
  const { files, ignored } = await expandZips(
    [zipFile("course.zip", { "Week 1/notes.pdf": text("notes"), "deck.pptx": text("deck") })],
    LIMITS
  );

  assert.deepEqual(files.map((f) => f.path).sort(), ["Week 1/notes.pdf", "deck.pptx"]);
  assert.equal(ignored, 0);
  // Extraction routes on the File's own name, so it must be the basename
  // rather than the whole in-archive path.
  assert.equal(files.find((f) => f.path.startsWith("Week 1"))?.file.name, "notes.pdf");
  assert.equal(await files.find((f) => f.path === "deck.pptx")!.file.text(), "deck");
});

test("files dropped alongside a zip pass through untouched", async () => {
  const plain = { path: "syllabus.pdf", file: new File([text("hello")], "syllabus.pdf") };
  const { files } = await expandZips([plain, zipFile("x.zip", { "a.pdf": text("a") })], LIMITS);
  assert.deepEqual(
    files.map((f) => f.path),
    ["syllabus.pdf", "a.pdf"]
  );
});

test("an entry over the per-file ceiling is left behind, not inflated", async () => {
  const { files, ignored } = await expandZips(
    [zipFile("big.zip", { "huge.pdf": new Uint8Array(2048), "small.pdf": text("ok") })],
    LIMITS
  );

  assert.deepEqual(
    files.map((f) => f.path),
    ["small.pdf"]
  );
  // Reported rather than dropped silently: a truncated import the user does
  // not know about is worse than a refused one.
  assert.equal(ignored, 1);
});

test("a zip that blows the whole-archive budget is refused by name, and the rest of the drop survives", async () => {
  // Entries that each clear the per-file ceiling but together do not fit the
  // archive budget — the classic bomb shape in miniature.
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i < 6; i++) entries[`f${i}.pdf`] = new Uint8Array(1000);
  const plain = { path: "syllabus.pdf", file: new File([text("hello")], "syllabus.pdf") };

  const { files, refused } = await expandZips([plain, zipFile("bomb.zip", entries)], {
    ...LIMITS,
    entries: 100,
  });

  // Throwing here used to discard `plain` with the archive.
  assert.deepEqual(
    files.map((f) => f.path),
    ["syllabus.pdf"]
  );
  assert.equal(refused.length, 1);
  assert.match(refused[0], /bomb\.zip unpacks to more than/);
});

test("an unreadable archive is refused by name rather than failing the drop", async () => {
  const plain = { path: "notes.pdf", file: new File([text("hi")], "notes.pdf") };
  const notAZip = { path: "broken.zip", file: new File([text("this is not a zip")], "broken.zip") };

  const { files, refused } = await expandZips([plain, notAZip], LIMITS);
  assert.deepEqual(
    files.map((f) => f.path),
    ["notes.pdf"]
  );
  assert.match(refused[0], /broken\.zip isn't a readable zip archive/);
});

test("only the first N entries of an oversized archive are taken", async () => {
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i < 5; i++) entries[`f${i}.pdf`] = text("x");

  const { files, ignored } = await expandZips([zipFile("many.zip", entries)], LIMITS);
  assert.equal(files.length, LIMITS.entries);
  assert.equal(ignored, 5 - LIMITS.entries);
});
