/**
 * LaTeX in, ASCII math out, for the subset that shows up in quiz *answers* —
 * fractions, roots, powers, greek letters, matrices. That is a much smaller
 * language than LaTeX at large, which is what makes a lexical pass viable
 * here when it would not be for a document.
 *
 * ponytail: a lexical converter, not a LaTeX parser. Unsupported commands
 * survive literally, but supported syntax nested inside them still converts
 * — e.g., `\text{\frac{1}{2}}` becomes `\text{((1)/(2))}`. This is safe
 * because both sides of a comparison run through the same converter, so a
 * pair either matches or does not for the same reason. Swap in a real LaTeX
 * parser only if answers start arriving with environments and macros that
 * change the meaning of nested content.
 */

/** Greek and the handful of named constants mathjs or a human would recognise. */
const NAMED: Record<string, string> = {
  alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta",
  epsilon: "epsilon", zeta: "zeta", eta: "eta", theta: "theta",
  iota: "iota", kappa: "kappa", lambda: "lambda", mu: "mu",
  nu: "nu", xi: "xi", rho: "rho", sigma: "sigma", tau: "tau",
  phi: "phi", chi: "chi", psi: "psi", omega: "omega", pi: "pi",
  infty: "Infinity",
};

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z]/.test(ch);
}

/**
 * Reads a `{...}` group starting at `open`, honouring nesting. Returns the
 * body and the index just past the closing brace, or null when the group is
 * unterminated — in which case the caller leaves the text alone.
 */
function readGroup(src: string, open: number): { body: string; next: number } | null {
  if (src[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(open + 1, i), next: i + 1 };
    }
  }
  return null;
}

/** `\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}` -> `[[1,2],[3,4]]`. */
function convertMatrices(src: string): string {
  return src.replace(
    /\\begin\{([pbvB]?matrix)\}([\s\S]*?)\\end\{\1\}/g,
    (_match, _env: string, body: string) => {
      const rows = body
        .split("\\\\")
        .map((row) => row.trim())
        .filter((row) => row.length > 0)
        .map((row) => row.split("&").map((cell) => latexToAscii(cell.trim())).join(","));
      return `[${rows.map((row) => `[${row}]`).join(",")}]`;
    }
  );
}

export function latexToAscii(input: string): string {
  let src = convertMatrices(input);

  // Delimiters and sizing commands carry no meaning for a comparison.
  src = src.replace(/\$\$?/g, "").replace(/\\left|\\right/g, "");
  // Escaped braces are set notation once the backslashes are gone.
  src = src.replace(/\\\{/g, "{").replace(/\\\}/g, "}");

  let out = "";
  let i = 0;

  while (i < src.length) {
    const rest = src.slice(i);

    // \frac{a}{b} -> ((a)/(b)), recursing into each argument.
    if (rest.startsWith("\\frac") && !isLetter(src[i + 5])) {
      const numerator = readGroup(src, i + 5);
      const denominator = numerator ? readGroup(src, numerator.next) : null;
      if (numerator && denominator) {
        out += `((${latexToAscii(numerator.body)})/(${latexToAscii(denominator.body)}))`;
        i = denominator.next;
        continue;
      }
    }

    // \sqrt{a} -> sqrt(a)
    if (rest.startsWith("\\sqrt") && !isLetter(src[i + 5])) {
      const radicand = readGroup(src, i + 5);
      if (radicand) {
        out += `sqrt(${latexToAscii(radicand.body)})`;
        i = radicand.next;
        continue;
      }
    }

    // ^{...} -> ^(...) so mathjs sees a grouped exponent.
    if (src[i] === "^" && src[i + 1] === "{") {
      const exponent = readGroup(src, i + 1);
      if (exponent) {
        out += `^(${latexToAscii(exponent.body)})`;
        i = exponent.next;
        continue;
      }
    }

    // _{1} -> _1. The underscore stays: `x_1` is one symbol, not two.
    if (src[i] === "_" && src[i + 1] === "{") {
      const subscript = readGroup(src, i + 1);
      if (subscript) {
        out += `_${latexToAscii(subscript.body)}`;
        i = subscript.next;
        continue;
      }
    }

    if (src[i] === "\\") {
      const name = /^\\([a-zA-Z]+)/.exec(rest)?.[1];
      if (name === "cdot" || name === "times" || name === "ast") {
        out += "*";
        i += name.length + 1;
        continue;
      }
      if (name === "div") {
        out += "/";
        i += name.length + 1;
        continue;
      }
      if (name && name in NAMED) {
        out += NAMED[name];
        i += name.length + 1;
        continue;
      }
      // Unknown command: emit the backslash and move on, so the whole token
      // survives into the string comparison rather than being half-eaten.
      out += src[i];
      i++;
      continue;
    }

    out += src[i];
    i++;
  }

  return out.trim();
}
