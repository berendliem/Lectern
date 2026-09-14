/**
 * Single-dollar inline math and prices in prose use the same character, and
 * remark-math resolves the ambiguity the wrong way for a lecture: in "The
 * textbook costs $5 and the reader costs $10", it reads everything between the
 * two dollars as a formula and renders the sentence as italic gibberish.
 *
 * Turning single-dollar math off is not the answer — `$x^2$` is exactly what
 * the models emit for inline math, and it is the common case in a STEM
 * lecture. So escape the dollars that open something money-shaped instead, and
 * leave the rest for remark-math.
 *
 * A `$` opens a price here when a digit follows it and the run up to the next
 * `$` carries no sign of LaTeX. That keeps `$5x^2$` (a coefficient) as math and
 * demotes `$5 and ... $10` (a price pair) to text.
 *
 * ponytail: a lexical heuristic, not a parser. It misreads `$5 dollars$` as a
 * price — LaTeX with no operators, opening on a digit. Swap in a real math
 * tokenizer if that ever shows up in someone's notes.
 */

/** Backslash commands, sub/superscripts, groups, and relations: no price has these. */
const LATEX_SIGNAL = /[\\^_{}=]/;

export function protectCurrency(markdown: string): string {
  // Each opener is judged on its own and nothing is consumed past it, so the
  // closing dollar of a price pair is still examined as an opener in its turn.
  return markdown.replace(/\$(?=\d)/g, (match, offset: number, full: string) => {
    const rest = full.slice(offset + 1);
    const end = rest.search(/[$\n]/);
    const closed = end !== -1 && rest[end] === "$";
    return closed && LATEX_SIGNAL.test(rest.slice(0, end)) ? match : "\\$";
  });
}
