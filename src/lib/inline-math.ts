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
 * `$` carries no sign of LaTeX and is not bare arithmetic. That keeps `$5x^2$`
 * (a coefficient) and `$5-1$` (a sum) as math and demotes `$5 and ... $10`
 * (a price pair) and `$5-$10` (a price range) to text.
 *
 * ponytail: a lexical heuristic, not a parser. It misreads `$5 dollars$` as a
 * price — LaTeX with no operators, opening on a digit. Swap in a real math
 * tokenizer if that ever shows up in someone's notes.
 */

/** Backslash commands, sub/superscripts, groups, and relations: no price has these. */
const LATEX_SIGNAL = /[\\^_{}=]/;

/**
 * An operator between two operands, ending on an operand, with no word anywhere:
 * `5-1` and `5x+1`, but not `5-10 and` or `5-10, ` (a price list runs on to the
 * next price, so its run ends on a separator). Capped because this path opens math
 * that no LaTeX asked for, and a long enough run of `1+1+…` stalls KaTeX in the tab.
 */
const MAX_ARITHMETIC_RUN = 120;

function isArithmetic(run: string): boolean {
  return (
    run.length <= MAX_ARITHMETIC_RUN &&
    /[\w)]\s*[-+*/]\s*[\w(]/.test(run) &&
    /[\w)]$/.test(run) &&
    !/[a-z]{2}/i.test(run)
  );
}

export function protectCurrency(markdown: string): string {
  // Each opener is judged on its own and nothing is consumed past it, so the
  // closing dollar of a price pair is still examined as an opener in its turn.
  return markdown.replace(/\$(?=\d)/g, (match, offset: number, full: string) => {
    const rest = full.slice(offset + 1);
    const end = rest.search(/[$\n]/);
    if (end === -1 || rest[end] !== "$") return "\\$";
    const run = rest.slice(0, end);
    return LATEX_SIGNAL.test(run) || isArithmetic(run) ? match : "\\$";
  });
}
