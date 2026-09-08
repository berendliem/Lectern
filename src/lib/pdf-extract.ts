"use client";

// pdfjs-dist references browser-only globals (DOMMatrix, etc.) at module
// evaluation time, which throws if the module is loaded during SSR. Import it
// lazily inside the function so it only ever loads in the browser, on user
// action. Extracting text client-side also keeps the PDF off the server —
// only the resulting text is uploaded.

import type { PDFPageProxy } from "pdfjs-dist";
import type { Worker as OcrWorker } from "tesseract.js";

// Scanned pages carry no text layer, so they are rendered and read with
// Tesseract instead. Note that this is the one part of the app that reaches a
// third party at runtime: tesseract.js loads its worker script, its wasm core
// and the language data from cdn.jsdelivr.net on first use, and runs the
// worker and core as code. The browser caches all three afterwards, and the
// page image itself never leaves the machine — but OCR does need the network
// once per browser profile, and trusts jsdelivr for it.
const OCR_LANG = process.env.NEXT_PUBLIC_OCR_LANG || "eng";
// A PDF point is 1/72", so scale 2 renders roughly 150 DPI. Tesseract reads
// body text reliably from about that; higher scales cost seconds per page for
// no accuracy gain on printed material.
const OCR_SCALE = 2;
// A page's dimensions come from its MediaBox, which the file declares and
// nothing validates — a PDF can claim a page metres across. Rendering that at
// scale 2 would ask for a canvas of billions of pixels and hang the tab, so
// pages that large are rendered at whatever scale fits this budget instead.
// 16M pixels is ~4000×4000, comfortably above an A4 page at scale 2 (~2M).
const MAX_OCR_PIXELS = 16_000_000;

export type OcrProgress = { page: number; pages: number };

export type ExtractOptions = {
  onOcrProgress?: (progress: OcrProgress) => void;
  /** Stops the page loop, so cancelling actually ends OCR rather than letting
   *  a 200-page scan grind on in the background. */
  signal?: AbortSignal;
};

function hasStr(item: unknown): item is { str: string } {
  return typeof item === "object" && item !== null && "str" in item && typeof (item as { str: unknown }).str === "string";
}

async function ocrPage(page: PDFPageProxy, worker: OcrWorker): Promise<string> {
  const full = page.getViewport({ scale: OCR_SCALE });
  const budget = Math.sqrt(MAX_OCR_PIXELS / (full.width * full.height));
  const viewport = budget < 1 ? page.getViewport({ scale: OCR_SCALE * budget }) : full;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({ canvas, viewport }).promise;
    const { data } = await worker.recognize(canvas);
    return data.text.replace(/\s+/g, " ").trim();
  } finally {
    // A full-page canvas at scale 2 is tens of megabytes of backing store, and
    // a browser is free to hold onto it after the element is dropped. Zeroing
    // the dimensions releases it now, which matters across a 200-page scan.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Text of every page, in order. A page with no text layer is OCR'd — that is
 * the whole of a scanned PDF, and the odd inserted image page in an otherwise
 * digital one. `onOcrProgress` fires only for those pages, since they are the
 * slow ones (seconds each, against milliseconds for a text layer).
 */
export async function extractPdfText(
  file: File,
  { onOcrProgress, signal }: ExtractOptions = {}
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data });
  const pages: string[] = [];
  // Built on first use, so a PDF that has a text layer throughout never pays
  // for the engine download at all.
  let ocr: OcrWorker | null = null;
  try {
    // Inside the try: a file that isn't a readable PDF rejects here, and the
    // loading task still holds a pdfjs worker that has to be destroyed.
    const pdf = await loadingTask.promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let line = content.items
        .map((item) => (hasStr(item) ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (!line) {
        onOcrProgress?.({ page: i, pages: pdf.numPages });
        if (!ocr) {
          const { createWorker } = await import("tesseract.js");
          ocr = await createWorker(OCR_LANG);
        }
        line = await ocrPage(page, ocr);
      }

      if (line) pages.push(line);
    }
  } finally {
    await ocr?.terminate();
    await loadingTask.destroy();
  }
  return pages.join("\n\n").trim();
}
