"use client";

// Photographed pages of notes, read by a vision model. The downscaling runs
// here rather than on the server so a 12MP phone photo never crosses the
// process boundary at full size — but unlike PDF and Office extraction, which
// finish in the browser, the page image itself does reach the model provider.
// Nothing stores it: the server hands back Markdown and forgets the picture.

import { MAX_SCAN_IMAGE_CHARS, MAX_SCAN_PAGES, SCAN_MAX_EDGE } from "@/lib/limits";

export type ScanProgress = { page: number; pages: number };

/** Fits `width`×`height` inside a `maxEdge` box, never scaling up. */
export function scaledSize(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const factor = maxEdge / longest;
  // Rounded away from zero: a panorama-shaped page must not lose its short
  // edge to a 0-pixel canvas.
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/** One document out of several transcribed pages, in the order given. */
export function joinScannedPages(pages: string[]): string {
  return pages
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

async function toDownscaledDataUrl(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      `could not be read as an image — HEIC photos need converting to JPEG first`
    );
  }

  const { width, height } = scaledSize(bitmap.width, bitmap.height, SCAN_MAX_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this browser would not give us a canvas to resize the page on");
    ctx.drawImage(bitmap, 0, 0, width, height);
    // 0.82 keeps pen strokes legible; higher mostly buys detail a model cannot
    // use and megabytes of upload.
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    if (dataUrl.length > MAX_SCAN_IMAGE_CHARS) {
      throw new Error("is still too large after downscaling");
    }
    return dataUrl;
  } finally {
    bitmap.close();
    // Same reason as the OCR canvas in pdf-extract.ts: release the backing
    // store now rather than when the browser feels like it.
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function scanOnePage(
  dataUrl: string,
  pageLabel: string | null,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch("/api/scan-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ image: dataUrl, ...(pageLabel ? { pageLabel } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "the model could not read that page");
  }
  const body = await res.json();
  if (typeof body.text !== "string" || !body.text.trim()) {
    throw new Error("the model returned nothing for that page");
  }
  return body.text;
}

/**
 * Transcribes every page and joins them into one document. Pages go one at a
 * time on purpose: the progress line stays truthful, and the browser is not
 * holding forty full-size bitmaps at once.
 */
export async function scanPagesToMarkdown(
  files: File[],
  opts: { signal?: AbortSignal; onProgress?: (p: ScanProgress) => void } = {}
): Promise<string> {
  if (files.length === 0) throw new Error("No pages to read.");
  if (files.length > MAX_SCAN_PAGES) {
    throw new Error(`That's ${files.length} pages; the limit is ${MAX_SCAN_PAGES} in one go.`);
  }

  const pages: string[] = [];
  for (const [index, file] of files.entries()) {
    if (opts.signal?.aborted) throw new Error("Cancelled.");
    opts.onProgress?.({ page: index + 1, pages: files.length });
    const label = files.length > 1 ? `page ${index + 1} of ${files.length}` : null;
    try {
      const dataUrl = await toDownscaledDataUrl(file);
      pages.push(await scanOnePage(dataUrl, label, opts.signal));
    } catch (e) {
      // Named, because "could not read that image" over a set of eight photos
      // leaves the user guessing which one to re-shoot.
      const detail = e instanceof Error ? e.message : "could not be read";
      throw new Error(`${file.name}: ${detail}`);
    }
  }

  const joined = joinScannedPages(pages);
  if (!joined) throw new Error("No readable text on those pages.");
  return joined;
}
