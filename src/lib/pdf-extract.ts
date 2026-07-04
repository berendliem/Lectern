"use client";

// pdfjs-dist references browser-only globals (DOMMatrix, etc.) at module
// evaluation time, which throws if the module is loaded during SSR. Import it
// lazily inside the function so it only ever loads in the browser, on user
// action. Extracting text client-side also keeps the PDF off the server —
// only the resulting text is uploaded.

function hasStr(item: unknown): item is { str: string } {
  return typeof item === "object" && item !== null && "str" in item && typeof (item as { str: unknown }).str === "string";
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => (hasStr(item) ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) pages.push(line);
  }
  await loadingTask.destroy();
  return pages.join("\n\n").trim();
}
