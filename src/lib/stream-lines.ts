// src/lib/stream-lines.ts
/**
 * Line framing for streamed responses. A network chunk can end mid-line, so
 * each reader keeps the unfinished tail until the next chunk completes it.
 */
function createLineSplitter() {
  let tail = "";
  return {
    push(chunk: string): string[] {
      tail += chunk;
      const lines = tail.split("\n");
      tail = lines.pop() ?? "";
      return lines;
    },
    flush(): string[] {
      const rest = tail;
      tail = "";
      return rest.trim() ? [rest] : [];
    },
  };
}

/** Newline-delimited JSON. A garbled line is dropped: one bad event must not end the stream. */
export function createNdjsonReader() {
  const lines = createLineSplitter();
  const parse = (batch: string[]): unknown[] =>
    batch.flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      try {
        return [JSON.parse(trimmed) as unknown];
      } catch {
        return [];
      }
    });
  return { push: (chunk: string) => parse(lines.push(chunk)), flush: () => parse(lines.flush()) };
}

/** Server-sent events: the `data:` payloads, without OpenRouter's `[DONE]` sentinel or its comment lines. */
export function createSseReader() {
  const lines = createLineSplitter();
  const data = (batch: string[]): string[] =>
    batch.flatMap((line) => {
      const trimmed = line.replace(/\r$/, "");
      if (!trimmed.startsWith("data:")) return [];
      const payload = trimmed.slice(5).trim();
      return payload && payload !== "[DONE]" ? [payload] : [];
    });
  return { push: (chunk: string) => data(lines.push(chunk)), flush: () => data(lines.flush()) };
}

async function* decodeChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export async function* ndjsonEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = createNdjsonReader();
  for await (const chunk of decodeChunks(body)) yield* reader.push(chunk);
  yield* reader.flush();
}

export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = createSseReader();
  for await (const chunk of decodeChunks(body)) yield* reader.push(chunk);
  yield* reader.flush();
}
