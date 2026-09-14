/**
 * Sentence segmentation over a list of text pieces.
 *
 * The notes are already rendered as markdown, so the text the reader should
 * hear lives in the DOM's text nodes rather than in the markdown source. This
 * module knows nothing about the DOM: give it the pieces in document order and
 * it gives back sentences addressed as (piece, offset) pairs, which the caller
 * turns back into a Range for the highlight.
 */

export type Sentence = {
  text: string;
  /** Index into the pieces array holding the sentence's first character. */
  startPiece: number;
  startOffset: number;
  /** Index into the pieces array holding the sentence's last character. */
  endPiece: number;
  /** Offset just past that last character, so (endPiece, endOffset) is exclusive. */
  endOffset: number;
};

/** Where a flat offset over the concatenated pieces lands. */
type Position = { piece: number; offset: number };

function locate(starts: number[], pieces: string[], index: number): Position {
  // Scanned from the end so that empty pieces, which share a start offset with
  // the piece after them, never win the match. Notes run to a few hundred text
  // nodes; a binary search would be more code than the scan it replaces.
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (pieces[i].length > 0 && starts[i] <= index) {
      return { piece: i, offset: index - starts[i] };
    }
  }
  return { piece: 0, offset: 0 };
}

/**
 * Split `pieces` into sentences. Segmentation follows the platform's own rules
 * (Intl.Segmenter), so abbreviations and non-Latin scripts behave the way the
 * rest of the OS does rather than the way a regex guesses.
 *
 * `blockStarts` holds the indices of pieces that open a new block — a new list
 * item, paragraph or heading. Rendered markup carries no whitespace between
 * those, so without the hint "Heat flows one way." and "Work is not free." in
 * adjacent list items concatenate into one run-on sentence. The separator goes
 * into the text being segmented but belongs to no piece, so the offsets still
 * address the pieces themselves.
 */
export function splitIntoSentences(
  pieces: string[],
  locale = "en",
  blockStarts?: ReadonlySet<number>
): Sentence[] {
  const starts: number[] = [];
  let flat = "";
  pieces.forEach((piece, i) => {
    if (i > 0 && blockStarts?.has(i)) flat += "\n";
    starts.push(flat.length);
    flat += piece;
  });
  if (flat.trim() === "") return [];

  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  const sentences: Sentence[] = [];
  for (const { segment, index } of segmenter.segment(flat)) {
    // Whitespace between sentences belongs to neither; including it would
    // stretch the highlight across the gap.
    const leading = segment.length - segment.trimStart().length;
    const text = segment.trim();
    if (text === "") continue;
    const from = index + leading;
    const start = locate(starts, pieces, from);
    const end = locate(starts, pieces, from + text.length - 1);
    sentences.push({
      text,
      startPiece: start.piece,
      startOffset: start.offset,
      endPiece: end.piece,
      endOffset: end.offset + 1,
    });
  }
  return sentences;
}

/**
 * The sentence containing (piece, offset), for resuming from a click. Returns
 * the following sentence when the position falls in the gap between two, and
 * -1 when there are no sentences at all.
 */
export function sentenceAt(sentences: Sentence[], piece: number, offset: number): number {
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const afterStart =
      piece > s.startPiece || (piece === s.startPiece && offset >= s.startOffset);
    const beforeEnd = piece < s.endPiece || (piece === s.endPiece && offset < s.endOffset);
    if (afterStart && beforeEnd) return i;
    if (!afterStart) return i; // in the gap before this one
  }
  return sentences.length > 0 ? sentences.length - 1 : -1;
}
