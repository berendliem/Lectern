// Where a dropped file goes. Pure string work, no DOM and no fflate, so the
// routing table is testable without a browser — the collecting and unzipping
// live in drop-files.ts.

export type MaterialKind = "SYLLABUS" | "SLIDES" | "READING" | "OTHER";

export type DropRoute =
  | { dest: "material"; extract: "pdf" | "pptx" | "docx" | "txt"; kind: MaterialKind }
  | { dest: "lecture" }
  | { dest: "skip"; reason: string };

// A dot-prefixed name anywhere in the path: AppleDouble twins (`._deck.pptx`)
// carry the same extension as the file they shadow and would otherwise import
// as a second, broken copy of it.
// Case-insensitive: a zip built on a case-sensitive filesystem can carry
// `__macosx/`, which would otherwise import as a folder of broken twins.
const JUNK = /(^|\/)(__MACOSX\/|\.)/i;

/** Reads as a syllabus rather than a reading, whatever the extension is. */
const SYLLABUS_NAME = /syllabus|outline/i;

export function routeDropFile(path: string): DropRoute {
  if (path.endsWith("/")) return { dest: "skip", reason: "folder" };
  if (JUNK.test(path)) return { dest: "skip", reason: "archive junk" };

  // A .txt named like a syllabus is a syllabus, not a transcript. The
  // extension check would otherwise send it to the transcript parser, which
  // rejects it for having no timestamps — and the modal lets you correct a
  // row's kind, never its destination.
  if (/\.txt$/i.test(path) && SYLLABUS_NAME.test(path)) {
    return { dest: "material", extract: "txt", kind: "SYLLABUS" };
  }
  if (/\.(vtt|srt|txt)$/i.test(path)) return { dest: "lecture" };

  // A zip inside a zip is rare and expanding it recursively invites a zip bomb
  // for no real gain, so it is named as skipped rather than silently dropped.
  if (/\.zip$/i.test(path)) return { dest: "skip", reason: "zip inside a zip" };

  const extract = /\.pptx$/i.test(path)
    ? "pptx"
    : /\.docx$/i.test(path)
      ? "docx"
      : /\.pdf$/i.test(path)
        ? "pdf"
        : null;
  if (!extract) {
    // Dropping a recording on a course is a reasonable first guess, and
    // "not a readable document" reads like the file is broken rather than
    // handled somewhere else.
    return /\.(mp3|m4a|wav|aac|flac|ogg|opus|mp4|mov|webm|mkv)$/i.test(path)
      ? { dest: "skip", reason: "audio and video are added on a lecture page, not here" }
      : { dest: "skip", reason: "not a readable document" };
  }

  const kind: MaterialKind = SYLLABUS_NAME.test(path)
    ? "SYLLABUS"
    : extract === "pptx"
      ? "SLIDES"
      : "READING";

  return { dest: "material", extract, kind };
}

/** Last path segment without its extension; the user can edit it before saving. */
export function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "").trim() || "Untitled";
}
