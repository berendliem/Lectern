/**
 * Where a walkthrough's steps come from. Pure: the routes own the database and
 * the model calls, this owns every boundary decision.
 *
 * Slides split on the `Slide N:` markers the pptx extractor emits — the same
 * shape `slideNumberFromChunk` in citations.ts depends on. Prose has no such
 * marker, so a reading is cut on headings the model supplies, and anything the
 * model names that is not actually in the text is skipped rather than guessed at.
 */

/**
 * Marks a card as born from a walkthrough, so a deck shows where it came from,
 * and so regenerating a material's cards knows these are the student's own
 * misses rather than generated cards it may replace.
 */
export const WALKTHROUGH_SOURCE_TERM = "From a walkthrough";

/**
 * Fingerprint of the text a walkthrough was split from, so a re-import that
 * changes the text can be noticed. Web Crypto rather than node:crypto: this
 * module is also bundled for the browser.
 */
export async function sourceHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

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
const SHORT_SLIDE_CHARS = 120;

/**
 * The most source text one step carries. The teach and marking prompts see no
 * more than this, so a step longer than it would be taught and graded from its
 * opening while the runner shows all of it; the splitters break it up instead.
 */
export const MAX_STEP_CHARS = 12_000;

/** `lastBody` is the body of the final slide in `text`, which may be several folded together. */
type RawSlide = { first: number; last: number; text: string; lastBody: string };

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

  const raw: RawSlide[] = starts.map((start, i) => {
    const block = text.slice(start.index, starts[i + 1]?.index ?? text.length).trim();
    return { first: start.num, last: start.num, text: block, lastBody: slideBody(block) };
  });

  // Forward fold: a short slide introduces the next one, so it joins it.
  const folded: RawSlide[] = [];
  let carry: RawSlide | null = null;
  for (let i = 0; i < raw.length; i++) {
    const slide = raw[i];
    const merged: RawSlide =
      carry === null
        ? slide
        : {
            first: carry.first,
            last: slide.last,
            text: `${carry.text}\n\n${slide.text}`,
            lastBody: slide.lastBody,
          };
    const isLast = i === raw.length - 1;
    if (!isLast && slide.lastBody.length < SHORT_SLIDE_CHARS) {
      carry = merged;
      continue;
    }
    folded.push(merged);
    carry = null;
  }

  // Backward fold: a short closing slide has nothing after it to introduce.
  if (folded.length > 1) {
    const last = folded[folded.length - 1];
    if (last.lastBody.length < SHORT_SLIDE_CHARS) {
      const prev = folded[folded.length - 2];
      folded.splice(folded.length - 2, 2, {
        first: prev.first,
        last: last.last,
        text: `${prev.text}\n\n${last.text}`,
        lastBody: last.lastBody,
      });
    }
  }

  // Text before the first marker is the deck's own opening: it joins the first
  // step rather than disappearing, as a reading's preamble does.
  const preamble = text.slice(0, starts[0].index).trim();
  if (preamble) folded[0] = { ...folded[0], text: `${preamble}\n\n${folded[0].text}` };

  return capSteps(folded.map((slide) => ({ label: slideLabel(slide), sourceText: slide.text })));
}

/**
 * Breaks any step longer than MAX_STEP_CHARS into consecutive steps, cutting
 * between paragraphs and mid-paragraph only when one paragraph alone is over
 * the cap. Ordinals are assigned here, so they stay contiguous.
 */
function capSteps(steps: { label: string; sourceText: string }[]): WalkthroughStepSeed[] {
  return steps
    .flatMap(({ label, sourceText }) => {
      const pieces = capText(sourceText);
      return pieces.length === 1
        ? [{ label, sourceText }]
        : pieces.map((piece, i) => ({ label: `${label} (${i + 1} of ${pieces.length})`, sourceText: piece }));
    })
    .map((step, ordinal) => ({ ordinal, ...step }));
}

function capText(text: string): string[] {
  if (text.length <= MAX_STEP_CHARS) return [text];
  const pieces: string[] = [];
  let current = "";
  for (const paragraph of text.split("\n\n")) {
    const joined = current ? `${current}\n\n${paragraph}` : paragraph;
    if (joined.length <= MAX_STEP_CHARS) {
      current = joined;
      continue;
    }
    if (current) pieces.push(current);
    current = paragraph;
    while (current.length > MAX_STEP_CHARS) {
      pieces.push(current.slice(0, MAX_STEP_CHARS));
      current = current.slice(MAX_STEP_CHARS);
    }
  }
  if (current) pieces.push(current);
  return pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0);
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
 * trimmed content equals the heading, or starts with it at a word boundary
 * ("Introduction: the setup", not "Introductions are due"), counts.
 */
function findHeadingLine(lines: Line[], heading: string, from: number): Line | null {
  const candidates = lines.filter((line) => line.start >= from);
  const exact = candidates.find((line) => line.content.trim() === heading);
  if (exact) return exact;
  return (
    candidates.find((line) => {
      const content = line.content.trim();
      return content.startsWith(heading) && !/[\p{L}\p{N}]/u.test(content.charAt(heading.length));
    }) ?? null
  );
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

  if (cuts.length === 0) return capSteps([{ label: "The whole text", sourceText: trimmed }]);

  return capSteps(
    cuts.map((cut, i) => {
      const end = cuts[i + 1]?.index ?? trimmed.length;
      // Text before the first heading is the reading's own opening: it joins the
      // first step rather than disappearing.
      const start = i === 0 ? 0 : cut.index;
      return { label: cut.heading, sourceText: trimmed.slice(start, end).trim() };
    })
  );
}
