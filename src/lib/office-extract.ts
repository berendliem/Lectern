"use client";

// pptx/docx are zip archives of XML parts. Unzipping in the browser keeps the
// original file off the server entirely — only the extracted text is uploaded,
// matching how pdf-extract.ts already works.

import { unzipSync, strFromU8 } from "fflate";
import { slideXmlToText, docxXmlToText, sortSlideEntries } from "@/lib/office-xml";

async function unzip(file: File): Promise<Record<string, Uint8Array>> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  try {
    return unzipSync(buffer);
  } catch {
    throw new Error("That file isn't a readable Office document.");
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
