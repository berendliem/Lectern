"use client";

// pptx/docx are zip archives of XML parts. Unzipping in the browser keeps the
// original file off the server entirely — only the extracted text is uploaded,
// matching how pdf-extract.ts already works.

import { unzipSync, strFromU8 } from "fflate";
import { slideXmlToText, docxXmlToText, sortSlideEntries } from "@/lib/office-xml";
import {
  MAX_OFFICE_COMPRESSED_PART_BYTES,
  MAX_OFFICE_FILE_BYTES,
  MAX_OFFICE_PART_BYTES,
  MAX_OFFICE_PARTS,
  MAX_OFFICE_TOTAL_BYTES,
} from "@/lib/limits";

/** The only parts read: slide bodies and the document body. */
const TEXT_PART = /^(ppt\/slides\/slide\d+\.xml|word\/document\.xml)$/;

async function unzip(file: File): Promise<Record<string, Uint8Array>> {
  if (file.size > MAX_OFFICE_FILE_BYTES) {
    throw new Error(
      `That file is ${Math.round(file.size / 1_000_000)} MB; the limit is ${MAX_OFFICE_FILE_BYTES / 1_000_000} MB.`
    );
  }
  const buffer = new Uint8Array(await file.arrayBuffer());
  try {
    // Inflate only the parts that get read. Without the filter every embedded
    // image, font and thumbnail is inflated first, and one crafted entry can be
    // gigabytes on the main thread. The declared size bounds the buffer, not
    // the work: inflate keeps decoding past a full buffer, so the compressed
    // size is capped too, and the parts are capped in number and in total.
    let parts = 0;
    let total = 0;
    let overCap = false;
    const entries = unzipSync(buffer, {
      filter: (entry) => {
        if (!TEXT_PART.test(entry.name)) return false;
        const fits =
          entry.size <= MAX_OFFICE_COMPRESSED_PART_BYTES &&
          entry.originalSize <= MAX_OFFICE_PART_BYTES &&
          ++parts <= MAX_OFFICE_PARTS &&
          (total += entry.originalSize) <= MAX_OFFICE_TOTAL_BYTES;
        if (!fits) overCap = true;
        return fits;
      },
    });
    // Refuse rather than drop: a missing slide would renumber every slide
    // after it, and a missing body would read as "no document body".
    if (overCap) throw new OfficeTooLargeError();
    return entries;
  } catch (e) {
    if (e instanceof OfficeTooLargeError) throw e;
    throw new Error("That file isn't a readable Office document.");
  }
}

class OfficeTooLargeError extends Error {
  constructor() {
    super("That file has more text than this importer reads in the browser. Export it as a PDF and import that instead.");
  }
}

/**
 * Slide text, one `Slide N: …` block per slide so retrieval can cite a slide
 * number. Slides with no text (image-only) are skipped but still counted.
 */
export async function extractPptxText(file: File): Promise<{ text: string; slideCount: number }> {
  const entries = await unzip(file);
  const slides = sortSlideEntries(Object.keys(entries));

  const blocks: string[] = [];
  slides.forEach((name, index) => {
    const text = slideXmlToText(strFromU8(entries[name]));
    if (text) blocks.push(`Slide ${index + 1}: ${text}`);
  });

  return { text: blocks.join("\n\n").trim(), slideCount: slides.length };
}

/** Document body text, paragraphs separated by newlines. */
export async function extractDocxText(file: File): Promise<string> {
  const entries = await unzip(file);
  const document = entries["word/document.xml"];
  if (!document) throw new Error("That .docx has no document body.");
  return docxXmlToText(strFromU8(document));
}
