import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

// ponytail: an hour without a byte covers a three-hour lecture on a slow
// machine (~15 min here at 12x realtime). It exists so a wedged service cannot
// pin a request open forever, not to bound honest work — raise it if a real
// recording ever hits it.
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * POSTs a form with node:http rather than fetch. Node's fetch gives up when
 * response headers take longer than 300 s, and a service that answers only
 * once its work is done — whisper on a long lecture — needs far longer.
 * node:http has no response timeout; the idle timeout is the only ceiling.
 */
export function postForm(
  url: URL,
  formData: FormData,
  idleTimeoutMs = IDLE_TIMEOUT_MS
): Promise<{ status: number; body: string }> {
  // Request serializes the multipart body and its boundary header for us. The
  // body is streamed rather than buffered, so a long recording is not held in
  // memory a second time as encoded multipart.
  const encoded = new Request(url, { method: "POST", body: formData });
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      { method: "POST", headers: { "content-type": encoded.headers.get("content-type") ?? "" } },
      (res) => {
        // Buffers, not string concatenation: a multi-byte character split
        // across two chunks would otherwise decode to replacement characters.
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      }
    );
    req.setTimeout(idleTimeoutMs, () => req.destroy(new Error(`no response after ${idleTimeoutMs / 1000} s`)));
    req.on("error", reject);
    pipeline(Readable.fromWeb(encoded.body as NodeReadableStream), req).catch(reject);
  });
}
