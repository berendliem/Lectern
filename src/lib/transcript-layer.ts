import { SLIDES_TRANSCRIPT_SOURCE } from "@/lib/prompts/summarize";

/** A transcript's two layers: what was said, and what it was said over. */
export type TranscriptLayers = {
  rawText: string;
  cleanText: string | null;
  contextText: string | null;
  contextSource: string | null;
};

type ExistingTranscript = { rawText: string; modelUsed: string | null; contextText: string | null };

/** The fields a transcription writes besides the audio itself. */
export type TranscriptWrite = {
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
 * Both layers as one block, for the readers that just need everything the
 * lecture covered — chat and the FTS index. The notes prompt does not use this:
 * it keeps the layers apart on purpose, so the deck can supply structure while
 * the recording supplies what was actually said.
 */
export function lectureText(transcript: TranscriptLayers | null | undefined): string {
  if (!transcript) return "";
  const spoken = transcript.cleanText ?? transcript.rawText;
  if (!transcript.contextText) return spoken;
  const label = transcript.contextSource === SLIDES_TRANSCRIPT_SOURCE ? "SLIDES" : "SOURCE TEXT";
  return `${label}:\n${transcript.contextText}\n\nLECTURE TRANSCRIPT:\n${spoken}`;
}

/** Why the notes on screen are behind the transcript, or null when they aren't. */
export function staleNotesMessage(
  notes: { updatedAt: Date } | null | undefined,
  transcript: (TranscriptLayers & { updatedAt: Date }) | null | undefined
): string | null {
  if (!notes || !transcript || notes.updatedAt >= transcript.updatedAt) return null;
  return transcript.contextText
    ? "These notes were written from the slides alone — the recording isn't in them yet."
    : "These notes were written before the current transcript.";
}
