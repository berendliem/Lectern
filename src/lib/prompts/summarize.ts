import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

// Shared by the transcript and slides prompts so the notes they produce
// render and parse identically.
const NOTES_JSON_SHAPE = `Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "markdown": string,   // the notes, written in Markdown with headings (##) and bullet points
  "keyTerms": [ { "term": string, "definition": string } ]  // 3-10 key terms from the lecture
}`;

const NOTES_MARKDOWN_GUIDELINES = `- Start with a single "## " heading summarizing the lecture topic, prefixed with one fitting emoji (e.g. "## 🧬 Cell Division").
- Use "### " subheadings to break the lecture into its main sections/topics, each prefixed with one fitting emoji.
- Use bullet points for facts, definitions, and examples. Keep bullets concise. Bold the key term in a bullet where it helps scanning.
- When the lecture compares things (two processes, pros/cons, before/after, categories with properties), present that as a Markdown table instead of bullets.
- Write any mathematics, chemistry, or formulae as LaTeX: $...$ inline, $$ alone on the lines above and below a displayed equation. Write code as a fenced block with its language. Never flatten either into prose.`;

export const SUMMARIZE_SYSTEM_PROMPT = `You are an expert study-notes writer. You turn raw lecture transcripts into clean, well-organized study notes.

${NOTES_JSON_SHAPE}

Guidelines for "markdown":
${NOTES_MARKDOWN_GUIDELINES}
- Do not invent information that wasn't in the transcript.
- Do not include a "Key Terms" section in the markdown itself; key terms go only in the keyTerms array.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildSummarizeUserPrompt(transcript: string, spellingGuide = ""): string {
  return `Here is a raw lecture transcript (it may contain speech-recognition errors, filler words, and run-on sentences). Turn it into clean study notes following the required JSON shape.${spellingGuide}\n\nTRANSCRIPT:\n"""\n${transcript}\n"""`;
}

// A lecture with no recording: the slides are all there is, and they are too
// terse to learn from as they stand. The model may fill the gaps, but every
// addition is fenced into a callout so the student can tell the deck's content
// from the model's.
export const SLIDES_SUMMARIZE_SYSTEM_PROMPT = `You are an expert study-notes writer. A student missed this lecture and no recording exists, so all you have is the text of the lecturer's slides. Turn it into study notes the student can learn from as if they had attended.

${NOTES_JSON_SHAPE}

Guidelines for "markdown":
${NOTES_MARKDOWN_GUIDELINES}
- Cover every point on the slides, in the order the deck presents them. Slide text is terse: turn fragments into clear, complete bullets without changing what they say.
- Where a slide is too terse to study from (a bare term, an unexplained formula, a list with no reasoning), add a short explanation or example the lecturer would likely have given, on its own line directly after the bullets it explains, with a blank line before it, written exactly as: > ℹ️ **Added context:** ...
- Anything not stated on the slides goes only in an Added context callout. Never mix your additions into ordinary bullets.
- Keep additions brief and to standard textbook knowledge. Never contradict the slides, and never invent specifics the slides don't give: dates, figures, names, course policies, deadlines, or exam hints. If a slide can't be interpreted, keep it as stated rather than guessing.
- Leave out slide furniture: "Slide N:" labels, page numbers, repeated headers and footers, and course codes.
- Do not include a "Key Terms" section in the markdown itself; key terms go only in the keyTerms array.

${UNTRUSTED_CONTENT_CLAUSE}`;

/**
 * The callout is the only thing telling the student which lines came from the
 * deck and which from the model, so a slide must not be able to write one.
 * The prompt copies slide text through nearly verbatim, so the marker is
 * flattened before the model sees it, not after.
 */
export function unmarkAddedContext(slides: string): string {
  return (
    slides
      // Zero-width and other format characters hide inside the words without
      // changing what a model reads; strip them so the match sees the words.
      .replace(/\p{Cf}/gu, "")
      // The emoji with or without a presentation selector, the bold markers
      // with or without inner spaces, and the colon on either side of them.
      // The `>` and the space after it go only as a pair, so a marker with no
      // `>` keeps the line break before it instead of gluing to the line above.
      .replace(
        /(?:>[ \t]*)?ℹ[︎️]?\s*\*\*\s*Added context\s*(?:[:：]\s*\*\*|\*\*\s*[:：])/giu,
        "Added context:"
      )
  );
}

export function buildSlidesSummarizeUserPrompt(slides: string, spellingGuide = ""): string {
  return `Here is the text extracted from a lecture's slides (it may be split into "Slide N:" blocks, image-only slides are missing, and a PDF export may break lines oddly). Turn it into study notes following the required JSON shape.${spellingGuide}\n\nSLIDES:\n"""\n${unmarkAddedContext(slides)}\n"""`;
}

/** `Transcript.modelUsed` of a page created from a slide deck, as written by
 *  the from-text route for `source: "slides"`. */
export const SLIDES_TRANSCRIPT_SOURCE = "import:slides";

/** `Transcript.modelUsed` of imported text with no more specific source — a
 *  reading or a paste. The from-text route writes it for `source: undefined`. */
export const IMPORT_TRANSCRIPT_SOURCE = "import";

// A lecture that has both a recording and the deck (or reading) it was given
// over. The material is the skeleton — written down, ordered, spelled correctly
// — and the recording is what actually happened in the room. Added context stays
// available for the rare term neither one explains, so the student can still
// tell the model's words from the lecturer's.
export const MERGED_SUMMARIZE_SYSTEM_PROMPT = `You are an expert study-notes writer. You have two records of one lecture: the lecturer's own material (their slides or the assigned reading), and a transcript of what the lecturer actually said while teaching it. Turn the pair into study notes.

${NOTES_JSON_SHAPE}

Guidelines for "markdown":
${NOTES_MARKDOWN_GUIDELINES}
- The lecturer's material sets the structure: follow its topics in the order it presents them, and cover every point on it.
- The transcript fills that structure in. Where the lecturer explained a point, worked an example, gave a caveat, or said what matters for the exam, put that in the notes in their words.
- Keep every worked example from the transcript in full: each step, each number, each intermediate result, and the answer. A worked example is the most valuable thing in a lecture and the first thing lost to summarizing.
- Where the transcript and the material disagree, prefer the transcript and say so in the bullet: the lecturer corrected the slide.
- Where the lecturer covered something that is not on the material at all, keep it as an ordinary bullet. It is the lecture, not an addition of yours.
- Only where neither the material nor the lecturer explains a term the notes depend on may you add one, on its own line after the bullets it explains, with a blank line before it, written exactly as: > ℹ️ **Added context:** ...
- Keep those additions brief and to standard textbook knowledge, and never invent specifics neither record gives: dates, figures, names, course policies, deadlines, or exam hints.
- Leave out slide furniture ("Slide N:" labels, page numbers, repeated headers and footers, course codes) and transcript furniture (filler, false starts, room noise, admin).
- Do not include a "Key Terms" section in the markdown itself; key terms go only in the keyTerms array.

${UNTRUSTED_CONTENT_CLAUSE}`;

function contextLabel(isSlides: boolean): string {
  return isSlides ? "SLIDES" : "READING";
}

export function buildMergedSummarizeUserPrompt(
  context: string,
  transcript: string,
  isSlides: boolean,
  spellingGuide = ""
): string {
  const source = isSlides ? "the lecturer's slides" : "the assigned reading";
  return `Here is ${source}, and a transcript of the lecture given over it. Merge them into study notes following the required JSON shape.${spellingGuide}\n\n${contextLabel(isSlides)}:\n"""\n${unmarkAddedContext(context)}\n"""\n\nLECTURE TRANSCRIPT:\n"""\n${transcript}\n"""`;
}

// The reduce half: the transcript arrives as interim notes from the map step,
// while the material still goes in whole.
export function buildMergedSummarizeReduceUserPrompt(
  context: string,
  interimNotes: string,
  isSlides: boolean,
  spellingGuide = ""
): string {
  const source = isSlides ? "the lecturer's slides" : "the assigned reading";
  return `Here is ${source}, and dense interim notes condensed in order from consecutive portions of the lecture given over it. Condensing added nothing, so treat the interim notes as what the lecturer said. Merge them into study notes following the required JSON shape (deduplicate overlap between portions, keep every distinct fact).${spellingGuide}\n\n${contextLabel(isSlides)}:\n"""\n${unmarkAddedContext(context)}\n"""\n\nINTERIM NOTES FROM THE LECTURE:\n"""\n${interimNotes}\n"""`;
}

/** The system prompt and the single-pass and reduce user prompts for a page.
 *  A page with both layers merges them; a page with only imported slide text
 *  keeps the slides prompt; everything else is a plain transcript. The map step
 *  is shared by all three: it only condenses, adding nothing. */
export function summarizePromptsFor(transcript: {
  modelUsed: string | null;
  contextText: string | null;
  contextSource: string | null;
}) {
  if (transcript.contextText) {
    const context = transcript.contextText;
    const isSlides = transcript.contextSource === SLIDES_TRANSCRIPT_SOURCE;
    return {
      systemPrompt: MERGED_SUMMARIZE_SYSTEM_PROMPT,
      buildUserPrompt: (spoken: string, spellingGuide = "") =>
        buildMergedSummarizeUserPrompt(context, spoken, isSlides, spellingGuide),
      buildReduceUserPrompt: (interimNotes: string, spellingGuide = "") =>
        buildMergedSummarizeReduceUserPrompt(context, interimNotes, isSlides, spellingGuide),
    };
  }
  return transcript.modelUsed === SLIDES_TRANSCRIPT_SOURCE
    ? {
        systemPrompt: SLIDES_SUMMARIZE_SYSTEM_PROMPT,
        buildUserPrompt: buildSlidesSummarizeUserPrompt,
        buildReduceUserPrompt: buildSlidesSummarizeReduceUserPrompt,
      }
    : {
        systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
        buildUserPrompt: buildSummarizeUserPrompt,
        buildReduceUserPrompt: buildSummarizeReduceUserPrompt,
      };
}

// Map step for long lectures (map-reduce): each transcript portion is first
// condensed into dense interim notes small enough that the combined result
// fits a local model's context window for the final (reduce) pass.
export const SUMMARIZE_MAP_SYSTEM_PROMPT = `You condense one portion of a longer lecture transcript into dense interim notes for a later summarization pass.

Rules:
- Output plain Markdown bullet points only — no headings, no preamble, no commentary.
- Preserve every distinct fact, definition, example, formula, number, and named term from this portion. Densify, don't drop.
- Keep formulae as LaTeX ($...$ inline, $$ on its own line above and below a displayed equation) and code in fenced blocks, so the final pass still has them.
- Keep the original order of ideas.
- Do not invent information that wasn't in the transcript portion.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildSummarizeMapUserPrompt(chunk: string, index: number, total: number): string {
  return `This is portion ${index + 1} of ${total} of a lecture transcript. Condense it into dense interim notes.\n\nTRANSCRIPT PORTION:\n"""\n${chunk}\n"""`;
}

export function buildSummarizeReduceUserPrompt(interimNotes: string, spellingGuide = ""): string {
  return `Here are dense interim notes taken from consecutive portions of one lecture, in order. Merge them into clean study notes following the required JSON shape (deduplicate overlap between portions, keep every distinct fact).${spellingGuide}\n\nINTERIM NOTES:\n"""\n${interimNotes}\n"""`;
}

// A long deck is condensed before the final pass, so without this the model
// would see anonymous interim notes and lose track of what counts as "stated on
// the slides" — the line every Added context callout depends on.
export function buildSlidesSummarizeReduceUserPrompt(interimNotes: string, spellingGuide = ""): string {
  return `Here are dense interim notes condensed, in order, from consecutive portions of one lecture's slides. Condensing added nothing, so treat them as what the slides say. Merge them into study notes following the required JSON shape (deduplicate overlap between portions, keep every distinct fact).${spellingGuide}\n\nINTERIM NOTES FROM THE SLIDES:\n"""\n${interimNotes}\n"""`;
}
