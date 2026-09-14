import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { postForm } from "./post-form.ts";

test("postForm sends the multipart body and returns status and body", async () => {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const received = await new Request("http://local", {
      method: "POST",
      headers: { "content-type": req.headers["content-type"] ?? "" },
      body: Buffer.concat(chunks),
    }).formData();
    const file = received.get("file") as File;
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: `${file.name}:${await file.text()}:${received.get("hotwords")}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const form = new FormData();
    form.append("file", new Blob(["ümlaut audio"], { type: "audio/webm" }), "audio.webm");
    form.append("hotwords", "Kubernetes");
    const res = await postForm(new URL(`http://127.0.0.1:${port}/transcribe`), form);
    assert.equal(res.status, 422);
    assert.equal(JSON.parse(res.body).detail, "audio.webm:ümlaut audio:Kubernetes");
  } finally {
    server.close();
  }
});

test("postForm gives up when the service goes silent past the idle timeout", async () => {
  const server = http.createServer((req) => req.resume());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await assert.rejects(postForm(new URL(`http://127.0.0.1:${port}/`), new FormData(), 100), /no response after/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("postForm rejects with the socket error code when nothing is listening", async () => {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await assert.rejects(postForm(new URL(`http://127.0.0.1:${port}/`), new FormData()), { code: "ECONNREFUSED" });
});
