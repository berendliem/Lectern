import { test } from "node:test";
import assert from "node:assert/strict";
import { createNdjsonReader, createSseReader, ndjsonEvents, sseData } from "./stream-lines.ts";

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

test("ndjson: a line split across chunks arrives once, whole", () => {
  const r = createNdjsonReader();
  assert.deepEqual(r.push('{"a":1}\n{"b"'), [{ a: 1 }]);
  assert.deepEqual(r.push(':2}\n'), [{ b: 2 }]);
  assert.deepEqual(r.flush(), []);
});

test("ndjson: a garbled line is dropped, not thrown", () => {
  const r = createNdjsonReader();
  assert.deepEqual(r.push('nope\n{"ok":true}\n'), [{ ok: true }]);
});

test("ndjson: flush returns an unterminated last line", () => {
  const r = createNdjsonReader();
  assert.deepEqual(r.push('{"x":1}'), []);
  assert.deepEqual(r.flush(), [{ x: 1 }]);
});

test("sse: data payloads only, without [DONE] or comments, CRLF tolerated", () => {
  const r = createSseReader();
  assert.deepEqual(r.push(": keep-alive\r\ndata: {\"a\":1}\r\n\r\ndata: [DO"), ['{"a":1}']);
  assert.deepEqual(r.push("NE]\n"), []);
});

test("ndjsonEvents reads a fetch body", async () => {
  const out: unknown[] = [];
  for await (const e of ndjsonEvents(bodyOf(['{"a":1}\n{"b"', ':2}\n']))) out.push(e);
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
});

test("sseData reads a fetch body", async () => {
  const out: string[] = [];
  for await (const d of sseData(bodyOf(["data: one\n", "data: two\ndata: [DONE]\n"]))) out.push(d);
  assert.deepEqual(out, ["one", "two"]);
});

test("leaving a stream early cancels its body", async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(encoder.encode('{"a":1}\n'));
    },
    cancel() {
      cancelled = true;
    },
  });
  for await (const e of ndjsonEvents(body)) {
    assert.deepEqual(e, { a: 1 });
    break;
  }
  assert.equal(cancelled, true);
});
