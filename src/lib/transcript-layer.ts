import { SLIDES_TRANSCRIPT_SOURCE } from "@/lib/prompts/summarize";

/** A transcript's two layers: what was said, and what it was said over. */
type TranscriptLayers = {
  rawText: string;
  cleanText: string | null;
  contextText: string | null;
  contextSource: string | null;
};

type ExistingTranscript = { rawText: string; modelUsed: string | null; contextText: string | null };

/** The fields a transcription writes besides the audio itself. */
type TranscriptWrite = {
  cleanText: null;
  chapters: null;
  contextText?: string;
  contextSource?: string | null;
};

/** Text that came from a file or a paste rather than from this app's ASR:
 *  `modelUsed` holds `import`, or `import:<source>` — never a model name. */
export function isImported(modelUsed: string | null): boolean {
  return modelUsed?.split(":")[0] === "import";
}

/** What the attached context layer is, for the copy that has to name it. */
export function contextKind(contextSource: string | null | undefined): "slides" | "reading" {
  return contextSource === SLIDES_TRANSCRIPT_SOURCE ? "slides" : "reading";
}

/** The first line of the attached context, short enough to quote in a confirm
 *  so a replace names the text it is about to discard. */
export function contextPreview(contextText: string | null | undefined): string | null {
  const line = contextText?.trim().split("\n")[0].trim();
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
}

/**
 * Whether recording here would destroy text that exists nowhere else.
 *
 * The page still holds imported text in `rawText`, and the context layer that
 * text would move down into is already holding a deck or a reading. Both layers
 * are the user's only copy — `prisma/dev.db` has no server backup — so the
 * transcribe route refuses instead of picking one to overwrite.
 */
export function recordingWouldDestroyImport(existing: ExistingTranscript | null | undefined): boolean {
  return (
    !!existing &&
    isImported(existing.modelUsed) &&
    existing.rawText.trim() !== "" &&
    existing.contextText !== null
  );
}

/**
 * What a new transcription writes on top of an existing transcript row.
 *
 * Imported text is never destroyed: it moves down into the context layer, where
 * the notes prompt reads it as the slides or the reading the lecture was given
 * over. A context layer already in place is never overwritten — that state is
 * refused up front by `recordingWouldDestroyImport`, and this function stays
 * safe on its own besides. `cleanText` and `chapters` go either way — both
 * described text that is being replaced, and the Transcript tab opens on the
 * cleaned view whenever `cleanText` exists, so a stale one shows the old text
 * labelled as the cleaned version of the new recording.
 */
export function planTranscribeWrite(existing: ExistingTranscript | null): TranscriptWrite {
  const write: TranscriptWrite = { cleanText: null, chapters: null };
  if (!existing || existing.contextText !== null) return write;
  if (!isImported(existing.modelUsed) || !existing.rawText.trim()) return write;
  return { ...write, contextText: existing.rawText, contextSource: existing.modelUsed };
}

/**
 * Each layer as its own labelled block, empty when the layer is absent. Both
 * layers are always labelled, even when only one exists, so a prompt that
 * labels its other sections is not asymmetric.
 *
 * Callers join these themselves: chat spends a character budget on them in its
 * own order, and the notes prompt keeps them apart on purpose, so the deck can
 * supply structure while the recording supplies what was actually said.
 */
export function lectureLayers(transcript: TranscriptLayers | null | undefined): {
  context: string;
  spoken: string;
} {
  if (!transcript) return { context: "", spoken: "" };
  const spoken = transcript.cleanText ?? transcript.rawText;
  const label = contextKind(transcript.contextSource) === "slides" ? "SLIDES" : "SOURCE TEXT";
  return {
    context: transcript.contextText ? `${label}:\n${transcript.contextText}` : "",
    spoken: spoken.trim() ? `LECTURE TRANSCRIPT:\n${spoken}` : "",
  };
}

/**
 * Joins blocks under a total character budget, spending it in the order given
 * and dropping what no longer fits. Chat's fallback prompt uses it to put the
 * spoken transcript ahead of the context layer: slicing the joined text instead
 * would let a long deck push the recording out of the prompt entirely, and the
 * answers would then come from the slides the student did not ask about.
 */
export function joinWithinBudget(blocks: string[], budget: number): string {
  const kept: string[] = [];
  let left = budget;
  for (const block of blocks) {
    if (!block || left <= 0) continue;
    const slice = block.slice(0, left);
    kept.push(slice);
    left -= slice.length + 2; // the "\n\n" that joins it to the next block
  }
  return kept.join("\n\n");
}

/** Why the notes on screen are behind the transcript, or null when they aren't. */
export function staleNotesMessage(
  notes: { updatedAt: Date } | null | undefined,
  transcript: (TranscriptLayers & { updatedAt: Date }) | null | undefined,
  hasAudio: boolean
): string | null {
  if (!notes || !transcript || notes.updatedAt >= transcript.updatedAt) return null;
  // With both layers on the page there is no way to tell which of them moved,
  // so the message says only what is certain: the notes are behind. Only the
  // context-without-audio case can name what is missing.
  if (transcript.contextText && !hasAudio) {
    const kind = contextKind(transcript.contextSource);
    return `These notes don't include the ${kind === "slides" ? "slides" : "reading"} attached to this lecture.`;
  }
  return "These notes were written before the current transcript.";
}
