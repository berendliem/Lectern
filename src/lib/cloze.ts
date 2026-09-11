/**
 * A cloze question is a sentence with one term taken out, and the blank has to
 * sit where the term was — that position is the whole point, and is what makes
 * it different from a short answer that happens to be short.
 *
 * The model marks the gap `{{term}}`. Splitting on it gives the text either
 * side, so the input can be rendered inline between them.
 *
 * A prompt with no marker still has to be answerable rather than throw: the
 * blank goes at the end, which reads as an ordinary fill-in question. Only the
 * first marker is honoured; a second one stays as literal text rather than
 * silently becoming a second ungraded blank.
 */
export type ClozeParts = { before: string; after: string };

// [\s\S] rather than the `s` flag: the project's TS target predates it.
const GAP = /\{\{[\s\S]*?\}\}/;

/**
 * The same sentence for somewhere there is no input to put in the gap — a
 * results list, an export. Prompts that carry no marker come back untouched,
 * so this is safe to apply to any question's prompt without knowing its type.
 */
export function blankCloze(prompt: string): string {
  return prompt.replace(GAP, "_____");
}

export function splitCloze(prompt: string): ClozeParts {
  const match = prompt.match(GAP);
  if (!match || match.index === undefined) return { before: prompt, after: "" };
  return {
    before: prompt.slice(0, match.index),
    after: prompt.slice(match.index + match[0].length),
  };
}
