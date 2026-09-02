import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cosine,
  courseChunkFilter,
  encodeVector,
  decodeVector,
  hashChunk,
  planChunkWork,
} from "./embed-math.ts";

test("cosine of identical vectors is 1", () => {
  const v = new Float32Array([1, 2, 3]);
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-6);
});

test("cosine of orthogonal vectors is 0", () => {
  assert.ok(Math.abs(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))) < 1e-6);
});

test("cosine of opposite vectors is -1", () => {
  const out = cosine(new Float32Array([1, 1]), new Float32Array([-1, -1]));
  assert.ok(Math.abs(out + 1) < 1e-6);
});

test("cosine returns 0 rather than NaN for a zero vector", () => {
  assert.equal(cosine(new Float32Array([0, 0]), new Float32Array([1, 1])), 0);
});

test("cosine refuses vectors of different lengths", () => {
  assert.throws(() => cosine(new Float32Array([1, 2]), new Float32Array([1, 2, 3])), /length/i);
});

test("a vector survives an encode/decode round trip", () => {
  const v = new Float32Array([0.5, -0.25, 1e-8, 3]);
  const back = decodeVector(encodeVector(v));
  assert.equal(back.length, v.length);
  for (let i = 0; i < v.length; i++) assert.equal(back[i], v[i]);
});

test("hashChunk is stable for the same text and differs for different text", () => {
  assert.equal(hashChunk("photosynthesis"), hashChunk("photosynthesis"));
  assert.notEqual(hashChunk("photosynthesis"), hashChunk("Photosynthesis"));
});

test("planChunkWork reuses chunks whose text and model are unchanged", () => {
  const model = "local:test";
  const texts = ["alpha", "beta"];
  const existing = texts.map((t, ord) => ({ ord, hash: hashChunk(t), model }));

  const plan = planChunkWork(existing, texts, model);

  assert.deepEqual(plan.reuse, [0, 1]);
  assert.deepEqual(plan.embed, []);
  assert.equal(plan.deleteFrom, 2);
});

test("planChunkWork re-embeds only the chunk whose text changed", () => {
  const model = "local:test";
  const existing = [
    { ord: 0, hash: hashChunk("alpha"), model },
    { ord: 1, hash: hashChunk("beta"), model },
  ];

  const plan = planChunkWork(existing, ["alpha", "gamma"], model);

  assert.deepEqual(plan.reuse, [0]);
  assert.equal(plan.embed.length, 1);
  assert.equal(plan.embed[0].ord, 1);
  assert.equal(plan.embed[0].text, "gamma");
});

test("planChunkWork re-embeds everything when the embedding model changed", () => {
  const existing = [
    { ord: 0, hash: hashChunk("alpha"), model: "openrouter:old" },
    { ord: 1, hash: hashChunk("beta"), model: "openrouter:old" },
  ];

  const plan = planChunkWork(existing, ["alpha", "beta"], "local:new");

  assert.deepEqual(plan.reuse, []);
  assert.equal(plan.embed.length, 2);
});

test("courseChunkFilter pins the query to the active model and both relations", () => {
  assert.deepEqual(courseChunkFilter("f1", "local:test"), {
    model: "local:test",
    OR: [{ page: { folderId: "f1" } }, { material: { folderId: "f1" } }],
  });
});

test("planChunkWork marks the tail for deletion when the text got shorter", () => {
  const model = "local:test";
  const existing = [
    { ord: 0, hash: hashChunk("alpha"), model },
    { ord: 1, hash: hashChunk("beta"), model },
    { ord: 2, hash: hashChunk("gamma"), model },
  ];

  const plan = planChunkWork(existing, ["alpha"], model);

  assert.deepEqual(plan.reuse, [0]);
  assert.equal(plan.deleteFrom, 1);
});
