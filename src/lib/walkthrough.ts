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

export function splitSections(text: string, headings: string[]): WalkthroughStepSeed[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  // Each heading is looked for after the previous one, so a phrase that also
  // appears in an earlier paragraph cannot cut the reading backwards.
  const cuts: { index: number; heading: string }[] = [];
  let from = 0;
  for (const heading of headings) {
    const at = trimmed.indexOf(heading, from);
    if (at < 0) continue;
    cuts.push({ index: at, heading });
    from = at + heading.length;
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
