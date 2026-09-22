/**
 * Where a walkthrough's steps come from. Pure: the routes own the database and
 * the model calls, this owns every boundary decision.
 *
 * Slides split on the `Slide N:` markers the pptx extractor emits — the same
 * shape `slideNumberFromChunk` in citations.ts depends on. Prose has no such
 * marker, so a reading is cut on headings the model supplies, and anything the
 * model names that is not actually in the text is skipped rather than guessed at.
 */

export type WalkthroughStepSeed = { ordinal: number; label: string; sourceText: string };

/** One step as the client sees it, once it exists as a row. */
export type WalkthroughStepView = {
  id: string;
  ordinal: number;
  label: string;
  sourceText: string;
  explanation: string | null;
  recallPrompt: string | null;
};

/** The one place a step row becomes what the client sees. */
export function toStepView(step: WalkthroughStepView): WalkthroughStepView {
  return {
    id: step.id,
    ordinal: step.ordinal,
    label: step.label,
    sourceText: step.sourceText,
    explanation: step.explanation,
    recallPrompt: step.recallPrompt,
  };
}

/**
 * A slide with less body text than this is a title card, a section divider, or a
 * lone image: it has nothing to teach on its own. A walkthrough that makes you
 * press Next through "Week 4" is a walkthrough people stop using.
 * ponytail: 120 chars is a guess; it is a threshold, so it is a knob.
 */
export const SHORT_SLIDE_CHARS = 120;

type RawSlide = { first: number; last: number; text: string };

/** Everything after the `Slide N:` marker itself — what the slide actually says. */
function slideBody(block: string): string {
  return block.replace(/^Slide \d+\s*:/, "").trim();
}

function slideLabel(slide: RawSlide): string {
  return slide.first === slide.last ? `Slide ${slide.first}` : `Slides ${slide.first}-${slide.last}`;
}

export function splitSlides(text: string): WalkthroughStepSeed[] {
  const starts: { index: number; num: number }[] = [];
  for (const match of text.matchAll(/^Slide (\d+)\s*:/gm)) {
    const num = Number(match[1]);
    if (Number.isFinite(num)) starts.push({ index: match.index, num });
  }
  if (starts.length === 0) return [];

  const raw: RawSlide[] = starts.map((start, i) => ({
    first: start.num,
    last: start.num,
    text: text.slice(start.index, starts[i + 1]?.index ?? text.length).trim(),
  }));

  // Forward fold: a short slide introduces the next one, so it joins it.
  const folded: RawSlide[] = [];
  let carry: RawSlide | null = null;
  for (let i = 0; i < raw.length; i++) {
    const slide = raw[i];
    const merged: RawSlide =
      carry === null
        ? slide
        : { first: carry.first, last: slide.last, text: `${carry.text}\n\n${slide.text}` };
    const isLast = i === raw.length - 1;
    if (!isLast && slideBody(slide.text).length < SHORT_SLIDE_CHARS) {
      carry = merged;
      continue;
    }
    folded.push(merged);
    carry = null;
  }

  // Backward fold: a short closing slide has nothing after it to introduce.
  if (folded.length > 1) {
    const last = folded[folded.length - 1];
    if (slideBody(last.text).length < SHORT_SLIDE_CHARS) {
      const prev = folded[folded.length - 2];
      folded.splice(folded.length - 2, 2, {
        first: prev.first,
        last: last.last,
        text: `${prev.text}\n\n${last.text}`,
      });
    }
  }

  return folded.map((slide, i) => ({
    ordinal: i,
    label: slideLabel(slide),
    sourceText: slide.text,
  }));
}

type Line = { start: number; content: string };

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  for (const match of text.matchAll(/^.*$/gm)) {
    lines.push({ start: match.index, content: match[0] });
  }
  return lines;
}

/**
 * The line a heading names, anchored to a whole line rather than a bare
 * substring — the same anchoring `^Slide N:` gives splitSlides. A heading
 * that also shows up mid-sentence in an earlier section's prose ("as Bar
 * covers below") cannot masquerade as the heading itself; only a line whose
 * trimmed content equals or starts with the heading counts.
 */
function findHeadingLine(lines: Line[], heading: string, from: number): Line | null {
  const candidates = lines.filter((line) => line.start >= from);
  const exact = candidates.find((line) => line.content.trim() === heading);
  if (exact) return exact;
  return candidates.find((line) => line.content.trim().startsWith(heading)) ?? null;
}

export function splitSections(text: string, headings: string[]): WalkthroughStepSeed[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const lines = linesOf(trimmed);

  // Each heading is looked for after the previous one, so a phrase that also
  // appears in an earlier paragraph cannot cut the reading backwards.
  const cuts: { index: number; heading: string }[] = [];
  let from = 0;
  for (const heading of headings) {
    const line = findHeadingLine(lines, heading, from);
    if (!line) continue;
    cuts.push({ index: line.start, heading });
    from = line.start + line.content.length;
  }

  if (cuts.length === 0) return [{ ordinal: 0, label: "The whole text", sourceText: trimmed }];

  return cuts.map((cut, i) => {
    const end = cuts[i + 1]?.index ?? trimmed.length;
    // Text before the first heading is the reading's own opening: it joins the
    // first step rather than disappearing.
    const start = i === 0 ? 0 : cut.index;
    return { ordinal: i, label: cut.heading, sourceText: trimmed.slice(start, end).trim() };
  });
}
