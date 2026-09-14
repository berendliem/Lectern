# Math Answer Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grade math answers in the quiz by what they mean rather than by which letters survive `replace(/[^a-z0-9\s]/g, " ")`.

**Architecture:** A new `MATH` question type whose answers go to `checkMathAnswer` — four strategies tried in order (canonical string, numeric, collection, random-point equivalence), each declining to the next when it cannot parse. A lexical `latexToAscii` converter feeds mathjs, which reads ASCII math and not LaTeX. Quiz prompts start rendering through the existing `<Markdown>` component so notation displays as notation.

**Tech Stack:** TypeScript, Next.js App Router, Prisma + SQLite, `mathjs` (new), `node:test` via tsx, KaTeX through `remark-math`/`rehype-katex`.

**Spec:** `docs/superpowers/specs/2026-09-13-math-answer-grading-design.md`

## Global Constraints

- **No LLM call on the grading path.** `checkMathAnswer` is pure, local, synchronous.
- **Numeric tolerance:** relative `1e-9`, absolute `1e-12` near zero. Exactly these values, everywhere a comparison happens.
- **Probe sampling:** 5 points, drawn from the continuous range 1.5 to 9.5. Never sample 0 or 1 — that is how `x^2` and `x` get declared equal.
- **Input cap:** 500 characters. Longer input skips every evaluator strategy and is compared as a string.
- **mathjs is hardened before use** — `import`, `createUnit`, `reviver`, `evaluate`, `parse`, `simplify`, `derivative`, `resolve` all overridden to throw. The student's answer is untrusted input.
- **Tests live in `src/lib/*.test.ts`** in `node:test` style (`import { test } from "node:test"`, `import assert from "node:assert/strict"`, relative `./x.ts` imports). `npm test` runs `node --import tsx --test "src/lib/**/*.test.ts"`.
- **No SQL migration.** `QuizQuestion.type` is a plain SQLite `TEXT` column with no CHECK constraint (`prisma/migrations/20260630211356_init/migration.sql:70`). Adding an enum value is a `schema.prisma` edit plus `npx prisma generate`. No data is touched and no snapshot is required.
- **Commit convention:** `<type>: <imperative lowercase phrase>`, one logical change per commit.

---

### Task 1: `latexToAscii`

The reference answers the model writes contain LaTeX. mathjs reads ASCII. This converter bridges the subset that appears in *answers* — a far narrower language than LaTeX at large — and passes anything else through unchanged so it degrades to a string comparison.

**Files:**
- Create: `src/lib/latex-ascii.ts`
- Test: `src/lib/latex-ascii.test.ts`
- Modify: `package.json` (add `mathjs`)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function latexToAscii(input: string): string`

- [ ] **Step 1: Install mathjs**

```bash
npm install mathjs
```

Nothing installed can parse or evaluate an expression — `katex` renders, `remark-math` locates, neither evaluates. It is installed in this task because Task 2 needs it; nothing in this task imports it.

- [ ] **Step 2: Write the failing test**

Create `src/lib/latex-ascii.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { latexToAscii } from "./latex-ascii.ts";

test("dollar delimiters are dropped", () => {
  assert.equal(latexToAscii("$x^2$"), "x^2");
  assert.equal(latexToAscii("$$1/2$$"), "1/2");
});

test("a fraction becomes a parenthesised division", () => {
  assert.equal(latexToAscii("\\frac{1}{2}"), "((1)/(2))");
  assert.equal(latexToAscii("\\frac{a+b}{c}"), "((a+b)/(c))");
});

test("nested fractions convert from the inside out", () => {
  assert.equal(latexToAscii("\\frac{\\frac{1}{2}}{3}"), "((((1)/(2)))/(3))");
});

test("sqrt becomes a function call", () => {
  assert.equal(latexToAscii("\\sqrt{2}"), "sqrt(2)");
});

test("multiplication commands become asterisks", () => {
  assert.equal(latexToAscii("2 \\cdot 3"), "2 * 3");
  assert.equal(latexToAscii("2 \\times 3"), "2 * 3");
});

test("left and right sizing commands are dropped", () => {
  assert.equal(latexToAscii("\\left(x+1\\right)"), "(x+1)");
});

test("a braced exponent becomes a parenthesised one", () => {
  assert.equal(latexToAscii("x^{10}"), "x^(10)");
  assert.equal(latexToAscii("2^{-1}"), "2^(-1)");
});

test("a braced subscript loses its braces and stays part of the name", () => {
  assert.equal(latexToAscii("x_{1}"), "x_1");
});

test("greek commands become their names", () => {
  assert.equal(latexToAscii("\\pi"), "pi");
  assert.equal(latexToAscii("\\alpha + \\beta"), "alpha + beta");
});

test("escaped braces become plain braces, so a set stays a set", () => {
  assert.equal(latexToAscii("\\{2, 3, 5\\}"), "{2, 3, 5}");
});

test("a matrix environment becomes nested brackets", () => {
  assert.equal(latexToAscii("\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}"), "[[1,2],[3,4]]");
  assert.equal(latexToAscii("\\begin{pmatrix}1 & 2\\end{pmatrix}"), "[[1,2]]");
});

test("an unsupported command passes through untouched", () => {
  assert.equal(latexToAscii("\\mathbb{R}^3"), "\\mathbb{R}^3");
});

test("plain ascii is returned unchanged", () => {
  assert.equal(latexToAscii("[[1,2],[3,4]]"), "[[1,2],[3,4]]");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/latex-ascii.test.ts`
Expected: FAIL — `Cannot find module './latex-ascii.ts'`

- [ ] **Step 4: Write the implementation**

Create `src/lib/latex-ascii.ts`:

```ts
/**
 * LaTeX in, ASCII math out, for the subset that shows up in quiz *answers* —
 * fractions, roots, powers, greek letters, matrices. That is a much smaller
 * language than LaTeX at large, which is what makes a lexical pass viable
 * here when it would not be for a document.
 *
 * ponytail: a lexical converter, not a LaTeX parser. Anything outside the
 * subset passes through unchanged, fails to parse in mathjs, and is compared
 * as a string instead — the right degradation, because an answer this cannot
 * read is exactly the answer that should be matched literally. Swap in a real
 * LaTeX parser only if answers start arriving with environments and macros.
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/latex-ascii.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Run the whole suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS — nothing else imports this yet, so nothing else can break.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/latex-ascii.ts src/lib/latex-ascii.test.ts
git commit -m "feat: convert the latex subset that appears in answers to ascii"
```

---

### Task 2: `checkMathAnswer` — canonical and numeric strategies

The two cheapest strategies, and the ones that carry most of the load. Canonical catches answers that *are* notation (`\det(A) = 0`); numeric makes `1/2`, `0.5`, and `\frac{1}{2}` one answer.

**Files:**
- Create: `src/lib/math-answer.ts`
- Test: `src/lib/math-answer.test.ts`

**Interfaces:**
- Consumes: `latexToAscii(input: string): string` from Task 1.
- Produces:
  - `export type MathStrategy = "canonical" | "numeric" | "collection" | "probe"`
  - `export type MathGrade = { isCorrect: boolean; strategy: MathStrategy }`
  - `export function checkMathAnswer(userAnswer: string, correctAnswer: string): MathGrade`
  - Internal, used by Tasks 3 and 4: `safeMath` (the hardened mathjs instance), `numbersEqual(a: number, b: number): boolean`, `parseOrNull`, `evaluateOrNull`, and the `STRATEGIES` list that later tasks append to.

- [ ] **Step 1: Write the failing test**

Create `src/lib/math-answer.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMathAnswer } from "./math-answer.ts";

test("an identical answer is correct", () => {
  assert.deepEqual(checkMathAnswer("42", "42"), { isCorrect: true, strategy: "canonical" });
});

test("notation that no evaluator can read is compared as a string", () => {
  assert.deepEqual(checkMathAnswer("\\det(A) = 0", "det(A)=0"), {
    isCorrect: true,
    strategy: "canonical",
  });
  assert.deepEqual(checkMathAnswer("\\mathbb{R}^3", "\\mathbb{R}^{3}"), {
    isCorrect: true,
    strategy: "canonical",
  });
});

test("a fraction, a decimal and its latex are one answer", () => {
  assert.deepEqual(checkMathAnswer("1/2", "0.5"), { isCorrect: true, strategy: "numeric" });
  assert.deepEqual(checkMathAnswer("\\frac{1}{2}", "0.5"), { isCorrect: true, strategy: "numeric" });
  assert.deepEqual(checkMathAnswer("2^{-1}", "0.5"), { isCorrect: true, strategy: "numeric" });
});

test("an arithmetic expression is evaluated, not matched", () => {
  assert.deepEqual(checkMathAnswer("120", "10*9*8/(3*2*1)"), {
    isCorrect: true,
    strategy: "numeric",
  });
});

test("a different number is wrong", () => {
  assert.deepEqual(checkMathAnswer("0.5", "0.6"), { isCorrect: false, strategy: "numeric" });
});

test("zero and a rounding crumb compare equal", () => {
  assert.deepEqual(checkMathAnswer("0", "1e-15"), { isCorrect: true, strategy: "numeric" });
});

test("an unreadable answer against a readable one is wrong, not a crash", () => {
  assert.deepEqual(checkMathAnswer("no idea", "42"), { isCorrect: false, strategy: "canonical" });
});

test("an empty answer is wrong", () => {
  assert.deepEqual(checkMathAnswer("", "42"), { isCorrect: false, strategy: "canonical" });
});

test("an answer past the length cap is compared as a string, never evaluated", () => {
  const huge = "9".repeat(600);
  assert.deepEqual(checkMathAnswer(huge, "9"), { isCorrect: false, strategy: "canonical" });
});

test("the risky mathjs functions are disabled", () => {
  assert.deepEqual(checkMathAnswer('parse("2+3")', "5"), {
    isCorrect: false,
    strategy: "canonical",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/math-answer.test.ts`
Expected: FAIL — `Cannot find module './math-answer.ts'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/math-answer.ts`:

```ts
import { create, all, type MathNode, type SymbolNode } from "mathjs";
import { latexToAscii } from "@/lib/latex-ascii";

/**
 * Grades a math answer by what it means rather than by which characters
 * survive tokenising. Four strategies run in order and the first to reach a
 * verdict wins; each declines when it cannot parse both sides, so an answer
 * no evaluator understands falls back to a string comparison rather than
 * being scored by accident.
 */

export type MathStrategy = "canonical" | "numeric" | "collection" | "probe";

export type MathGrade = {
  isCorrect: boolean;
  /** Which strategy decided. Recorded on the attempt so a miscalibrated one is visible. */
  strategy: MathStrategy;
};

/** A strategy returns its verdict, or null to decline and let the next one try. */
type Strategy = { name: MathStrategy; decide: (user: string, correct: string) => boolean | null };

/**
 * The student's answer is untrusted input. mathjs names the functions that
 * make its parser dangerous and the documented hardening is to override them;
 * this instance is the only one the grader ever uses.
 */
const safeMath = create(all);
const DISABLED = ["import", "createUnit", "reviver", "evaluate", "parse", "simplify", "derivative", "resolve"];
safeMath.import(
  Object.fromEntries(
    DISABLED.map((name) => [name, () => { throw new Error(`Function ${name} is disabled`); }])
  ),
  { override: true }
);

/** Long enough for any real answer; short enough that a pathological input cannot run away. */
const MAX_LENGTH = 500;

const RELATIVE_TOLERANCE = 1e-9;
const ABSOLUTE_TOLERANCE = 1e-12;

export function numbersEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const difference = Math.abs(a - b);
  // The absolute arm first: near zero the relative test divides by nothing
  // useful, and 0 against 1e-15 is a rounding crumb, not a wrong answer.
  if (difference <= ABSOLUTE_TOLERANCE) return true;
  return difference <= RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

/** Parses with the hardened instance. Null means "this strategy cannot read it". */
export function parseOrNull(text: string): MathNode | null {
  try {
    return safeMath.parse(text);
  } catch {
    return null;
  }
}

export function evaluateOrNull(node: MathNode, scope: Record<string, number> = {}): unknown {
  try {
    return node.evaluate(scope);
  } catch {
    return null;
  }
}

/**
 * Whitespace, case and the spellings of multiplication carry no meaning for a
 * comparison, so they are removed before the strings are matched.
 */
function canonicalise(text: string): string {
  return text.replace(/\s+/g, "").replace(/\*/g, "·").toLowerCase();
}

const numericStrategy: Strategy = {
  name: "numeric",
  decide(user, correct) {
    const userNode = parseOrNull(user);
    const correctNode = parseOrNull(correct);
    if (!userNode || !correctNode) return null;

    const userValue = evaluateOrNull(userNode);
    const correctValue = evaluateOrNull(correctNode);
    if (typeof userValue !== "number" || typeof correctValue !== "number") return null;

    return numbersEqual(userValue, correctValue);
  },
};

/** Tasks 3 and 4 append to this list, in order. */
export const STRATEGIES: Strategy[] = [numericStrategy];

export function checkMathAnswer(userAnswer: string, correctAnswer: string): MathGrade {
  const user = latexToAscii(userAnswer);
  const correct = latexToAscii(correctAnswer);

  if (canonicalise(user) === canonicalise(correct) && correct.length > 0) {
    return { isCorrect: true, strategy: "canonical" };
  }

  // Past the cap nothing is parsed. The string comparison above already ran,
  // so there is still a verdict.
  if (user.length <= MAX_LENGTH && correct.length <= MAX_LENGTH) {
    for (const strategy of STRATEGIES) {
      const verdict = strategy.decide(user, correct);
      if (verdict !== null) return { isCorrect: verdict, strategy: strategy.name };
    }
  }

  return { isCorrect: false, strategy: "canonical" };
}
```

The `SymbolNode` type import is unused until Task 4 — if the linter rejects an unused import, add it in Task 4 instead of here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/math-answer.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/math-answer.ts src/lib/math-answer.test.ts
git commit -m "feat: grade math answers by canonical string and numeric value"
```

---

### Task 3: The collection strategy — sets, vectors, matrices

`{2,3,5}` is the discrete math answer shape; `[[1,2],[3,4]]` is the linear algebra one. mathjs parses brackets natively and has no set literal at all, so braces are split by hand.

**Files:**
- Modify: `src/lib/math-answer.ts`
- Test: `src/lib/math-answer.test.ts`

**Interfaces:**
- Consumes: `numbersEqual`, `parseOrNull`, `evaluateOrNull`, `safeMath`, `STRATEGIES` from Task 2.
- Produces: appends `collectionStrategy` to `STRATEGIES`, before the probe strategy that Task 4 adds.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/math-answer.test.ts`:

```ts
test("a set ignores order and duplicates", () => {
  assert.deepEqual(checkMathAnswer("{2,3,5}", "{5,3,2}"), {
    isCorrect: true,
    strategy: "collection",
  });
  assert.deepEqual(checkMathAnswer("{2,2,3}", "{3,2}"), {
    isCorrect: true,
    strategy: "collection",
  });
});

test("a set with a different member is wrong", () => {
  assert.deepEqual(checkMathAnswer("{2,3}", "{2,4}"), {
    isCorrect: false,
    strategy: "collection",
  });
});

test("set elements are evaluated, so 1/2 and 0.5 are the same member", () => {
  assert.deepEqual(checkMathAnswer("{1/2, 3}", "{0.5, 3}"), {
    isCorrect: true,
    strategy: "collection",
  });
});

test("an identical matrix matches as a string, and a rewritten one element-wise", () => {
  assert.deepEqual(checkMathAnswer("[[1,2],[3,4]]", "[[1,2],[3,4]]"), {
    isCorrect: true,
    strategy: "canonical",
  });
  assert.deepEqual(
    checkMathAnswer("[[1,2],[3,4]]", "\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}"),
    { isCorrect: true, strategy: "canonical" }
  );
  assert.deepEqual(checkMathAnswer("[[1/2,2],[3,4]]", "[[0.5,2],[3,4]]"), {
    isCorrect: true,
    strategy: "collection",
  });
});

test("a transposed matrix is a different answer", () => {
  assert.deepEqual(checkMathAnswer("[[1,2],[3,4]]", "[[1,3],[2,4]]"), {
    isCorrect: false,
    strategy: "collection",
  });
});

test("a vector's order matters", () => {
  assert.deepEqual(checkMathAnswer("[1,2,3]", "[3,2,1]"), {
    isCorrect: false,
    strategy: "collection",
  });
});

test("a shape mismatch is wrong", () => {
  assert.deepEqual(checkMathAnswer("[[1,2]]", "[[1,2],[3,4]]"), {
    isCorrect: false,
    strategy: "collection",
  });
});

test("a set and a vector of the same numbers are different answers", () => {
  assert.deepEqual(checkMathAnswer("{2,3}", "[2,3]"), {
    isCorrect: false,
    strategy: "collection",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/math-answer.test.ts`
Expected: FAIL — the new cases report `strategy: "canonical"`, and the ones that should be equal report `isCorrect: false`.

- [ ] **Step 3: Write the implementation**

In `src/lib/math-answer.ts`, add above `export const STRATEGIES`:

```ts
/**
 * Splits on the commas that are not inside a bracket or brace, so
 * `{[1,2], 3}` is two elements and not three.
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** `{...}` to its evaluated members. Null when it is not a set, or a member will not evaluate. */
function parseSet(text: string): number[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  const members: number[] = [];
  for (const element of splitTopLevel(trimmed.slice(1, -1))) {
    const node = parseOrNull(element);
    const value = node ? evaluateOrNull(node) : null;
    if (typeof value !== "number") return null;
    members.push(value);
  }
  return members;
}

/** Order-insensitive, duplicates collapsed, compared with the numeric tolerance. */
function setsEqual(a: number[], b: number[]): boolean {
  const dedupe = (values: number[]) =>
    values.filter((value, index) => values.findIndex((other) => numbersEqual(value, other)) === index);

  const left = dedupe(a);
  const right = dedupe(b);
  if (left.length !== right.length) return false;
  return left.every((value) => right.some((other) => numbersEqual(value, other)));
}

/** A nested array of numbers, or null when the value is not one. */
function toNestedNumbers(value: unknown): unknown[] | null {
  const array = safeMath.isMatrix(value) ? value.toArray() : value;
  return Array.isArray(array) ? array : null;
}

function nestedEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((element, index) => nestedEqual(element, b[index]));
  }
  if (typeof a === "number" && typeof b === "number") return numbersEqual(a, b);
  return false;
}

const collectionStrategy: Strategy = {
  name: "collection",
  decide(user, correct) {
    const userSet = parseSet(user);
    const correctSet = parseSet(correct);
    if (userSet && correctSet) return setsEqual(userSet, correctSet);

    // A set against a vector is a mismatch, not a decline: they are different
    // answers, and saying so is the correct verdict rather than a shrug.
    if (userSet || correctSet) {
      const other = userSet ? correct : user;
      const otherNode = parseOrNull(other);
      const otherValue = otherNode ? evaluateOrNull(otherNode) : null;
      return toNestedNumbers(otherValue) ? false : null;
    }

    const userNode = parseOrNull(user);
    const correctNode = parseOrNull(correct);
    if (!userNode || !correctNode) return null;

    const userArray = toNestedNumbers(evaluateOrNull(userNode));
    const correctArray = toNestedNumbers(evaluateOrNull(correctNode));
    if (!userArray || !correctArray) return null;

    return nestedEqual(userArray, correctArray);
  },
};
```

Then extend the list:

```ts
export const STRATEGIES: Strategy[] = [numericStrategy, collectionStrategy];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/math-answer.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Run the whole suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/math-answer.ts src/lib/math-answer.test.ts
git commit -m "feat: compare sets, vectors and matrices element-wise"
```

---

### Task 4: The probe strategy — random-point equivalence

`(x+1)^2` and `x^2+2x+1` are the same answer. Deciding that without a CAS means substituting random values into both and seeing whether they agree.

**Files:**
- Modify: `src/lib/math-answer.ts`
- Test: `src/lib/math-answer.test.ts`

**Interfaces:**
- Consumes: `numbersEqual`, `parseOrNull`, `evaluateOrNull`, `STRATEGIES` from Task 2; the `MathNode` and `SymbolNode` types from mathjs.
- Produces: appends `probeStrategy` to `STRATEGIES`, last in order.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/math-answer.test.ts`:

```ts
test("an expanded polynomial equals its factored form", () => {
  assert.deepEqual(checkMathAnswer("(x+1)^2", "x^2+2x+1"), {
    isCorrect: true,
    strategy: "probe",
  });
});

test("x squared is not two x, which is the collision the old grader scored 1.0", () => {
  assert.deepEqual(checkMathAnswer("x^2", "2x"), { isCorrect: false, strategy: "probe" });
});

test("a rename is a different answer", () => {
  assert.deepEqual(checkMathAnswer("x+1", "y+1"), { isCorrect: false, strategy: "probe" });
});

test("a two-variable expression is probed in both variables", () => {
  assert.deepEqual(checkMathAnswer("(a+b)^2", "a^2+2*a*b+b^2"), {
    isCorrect: true,
    strategy: "probe",
  });
});

test("a function call's name is not treated as a variable", () => {
  assert.deepEqual(checkMathAnswer("sqrt(x)*sqrt(x)", "x"), {
    isCorrect: true,
    strategy: "probe",
  });
});

test("an expression with a pole is still decided, not crashed on", () => {
  assert.deepEqual(checkMathAnswer("1/(x-1)", "1/(x-1)"), {
    isCorrect: true,
    strategy: "canonical",
  });
  assert.deepEqual(checkMathAnswer("1/(x-1)", "1/(x+1)"), {
    isCorrect: false,
    strategy: "probe",
  });
});

test("a constant expression never reaches the probe", () => {
  assert.deepEqual(checkMathAnswer("2+2", "4"), { isCorrect: true, strategy: "numeric" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/math-answer.test.ts`
Expected: FAIL — the polynomial cases report `strategy: "canonical"` and `isCorrect: false`.

- [ ] **Step 3: Write the implementation**

In `src/lib/math-answer.ts`, add above `export const STRATEGIES`:

```ts
/** Five points is decisive for an answer box: two different polynomials agree at finitely many. */
const PROBE_POINTS = 5;
/** Away from 0 and 1, where x, x^2 and sqrt(x) all agree. Non-integer, so lattice coincidences do not bite. */
const PROBE_MIN = 1.5;
const PROBE_MAX = 9.5;
/** A pole or a log of a negative discards the point; this bounds the redraws. */
const MAX_DRAWS = PROBE_POINTS * 6;

/** mathjs resolves these itself — they are constants, not the student's variables. */
const RESERVED = new Set(["pi", "e", "tau", "phi", "i", "Infinity", "NaN", "null", "true", "false"]);

/**
 * The symbols a caller must supply values for. A function's name is a
 * SymbolNode too — `sqrt(x)` holds one at `fn` — so the path is checked to
 * keep `sqrt` out of the variable list.
 */
function freeVariables(node: MathNode): string[] {
  const names = new Set<string>();
  node.filter((candidate, path, parent) => {
    const isCallee = parent !== null && parent.type === "FunctionNode" && path === "fn";
    if (candidate.type === "SymbolNode" && !isCallee) {
      const name = (candidate as SymbolNode).name;
      if (!RESERVED.has(name)) names.add(name);
    }
    return false;
  });
  return [...names].sort();
}

const probeStrategy: Strategy = {
  name: "probe",
  decide(user, correct) {
    const userNode = parseOrNull(user);
    const correctNode = parseOrNull(correct);
    if (!userNode || !correctNode) return null;

    const userVariables = freeVariables(userNode);
    const correctVariables = freeVariables(correctNode);
    if (userVariables.length === 0 || correctVariables.length === 0) return null;

    // `x + 1` and `y + 1` are different answers, not one expression renamed.
    if (userVariables.join(",") !== correctVariables.join(",")) return false;

    let agreements = 0;
    for (let draw = 0; draw < MAX_DRAWS && agreements < PROBE_POINTS; draw++) {
      const scope: Record<string, number> = {};
      for (const name of userVariables) {
        scope[name] = PROBE_MIN + Math.random() * (PROBE_MAX - PROBE_MIN);
      }

      const userValue = evaluateOrNull(userNode, scope);
      const correctValue = evaluateOrNull(correctNode, scope);
      // Undefined for one side at this point: discard it and draw again rather
      // than call a domain error a disagreement.
      if (typeof userValue !== "number" || typeof correctValue !== "number") continue;
      if (!Number.isFinite(userValue) || !Number.isFinite(correctValue)) continue;

      if (!numbersEqual(userValue, correctValue)) return false;
      agreements++;
    }

    // Too few usable points to be sure of anything. Declining is honest;
    // guessing is how a wrong answer gets marked right.
    return agreements === PROBE_POINTS ? true : null;
  },
};
```

Then extend the list:

```ts
export const STRATEGIES: Strategy[] = [numericStrategy, collectionStrategy, probeStrategy];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/math-answer.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Run the file twenty times to prove the randomness is not flaky**

```bash
for i in $(seq 1 20); do node --import tsx --test src/lib/math-answer.test.ts > /dev/null || echo "FAILED on run $i"; done; echo done
```

Expected: `done`, with no `FAILED` lines. A verdict that depends on which points were drawn is a bug in the strategy, not a flaky test — if this fails, raise `PROBE_POINTS` or widen the sample range rather than deleting the case.

- [ ] **Step 6: Run the whole suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/math-answer.ts src/lib/math-answer.test.ts
git commit -m "feat: decide symbolic equivalence by probing random points"
```

---

### Task 5: The `MATH` question type — schema, validation, generation

Wires the type through the three places that describe a question: the datamodel, the zod schema that admits a model's response, and the prompt that asks for one.

**Files:**
- Modify: `prisma/schema.prisma:21-28`
- Modify: `src/lib/validation.ts:312-340` (the `quizResponseSchema` union)
- Modify: `src/lib/prompts/quiz.ts`
- Test: `src/lib/validation.test.ts` (run `ls src/lib/validation.test.ts` first; create it if absent, append if present)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `QuestionType.MATH` in the generated Prisma client; a `{ type: "MATH", prompt, correctAnswer, explanation? }` member in `quizResponseSchema`.

- [ ] **Step 1: Write the failing test**

Create or append to `src/lib/validation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { quizResponseSchema } from "./validation.ts";

test("a math question is accepted", () => {
  const parsed = quizResponseSchema.parse({
    questions: [
      {
        type: "MATH",
        prompt: "What is $\\det(A)$ for $A = \\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}$?",
        correctAnswer: "-2",
        explanation: "1*4 - 2*3",
      },
    ],
  });
  assert.equal(parsed.questions[0].type, "MATH");
});

test("a math question with no answer is rejected", () => {
  assert.throws(() =>
    quizResponseSchema.parse({ questions: [{ type: "MATH", prompt: "p", correctAnswer: "" }] })
  );
});

test("an unknown question type is still rejected", () => {
  assert.throws(() =>
    quizResponseSchema.parse({ questions: [{ type: "PROOF", prompt: "p", correctAnswer: "a" }] })
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/validation.test.ts`
Expected: FAIL — the discriminated union has no `MATH` member, so the first case throws.

- [ ] **Step 3: Add the enum value and regenerate the client**

In `prisma/schema.prisma`, inside `enum QuestionType`, after `CLOZE`:

```prisma
  /// An answer that is a value rather than prose — a number, a fraction, a
  /// set, a vector, a matrix, or an expression. `correctAnswer` holds one
  /// canonical value in ASCII and is graded by `checkMathAnswer`, not by the
  /// token overlap the other free-text types get.
  MATH
```

Then:

```bash
npx prisma generate
```

No SQL migration and no snapshot: `QuizQuestion.type` is a `TEXT` column with no CHECK constraint, so this changes generated TypeScript only and touches no row in `prisma/dev.db`.

- [ ] **Step 4: Add the validation member**

In `src/lib/validation.ts`, add a fourth member to the `quizResponseSchema` discriminated union, after the `CLOZE` member:

```ts
        z.object({
          type: z.literal("MATH"),
          prompt: z.string().min(1),
          // One canonical value, in ASCII. A sentence here would be graded as
          // a value by a checker that expects one.
          correctAnswer: z.string().min(1),
          explanation: z.string().optional(),
        }),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/validation.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Teach the generator to write MATH questions**

In `src/lib/prompts/quiz.ts`, add a fourth shape to the JSON object in `QUIZ_SYSTEM_PROMPT`, after the `CLOZE` entry:

```
    {
      "type": "MATH",
      "prompt": string,               // LaTeX for the notation; it will be rendered
      "correctAnswer": string,        // one canonical value in plain ASCII
      "explanation": string
    }
```

And add these guidelines to the list:

```
- Use MATH when the answer is a value the student computes: a number, a fraction, a set, a vector, a matrix, or an expression. Notes with mathematical content should get several.
- Write MATH prompts with LaTeX for the notation ($x^2$, $\\det(A)$, $\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}$) — it is rendered, not shown as source.
- Write a MATH correctAnswer as one canonical value in plain ASCII: "1/2", "-2", "[[1,2],[3,4]]", "{2,3,5}", "x^2+1". Not LaTeX, not a sentence, no units, no "the answer is".
- Never use MATH for a proof, a derivation, or an "explain why" question. Those are SHORT_ANSWER.
```

- [ ] **Step 7: Run the whole suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS. Both generate-quiz routes persist `type: q.type` generically and need no change.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma src/generated src/lib/validation.ts src/lib/validation.test.ts src/lib/prompts/quiz.ts
git commit -m "feat: add the MATH question type to the schema, validation and quiz prompt"
```

---

### Task 6: Grade MATH answers in the route

**Files:**
- Modify: `src/app/api/quiz/[questionId]/answer/route.ts:20-33`

**Interfaces:**
- Consumes: `checkMathAnswer` from Task 2, `QuestionType.MATH` from Task 5.
- Produces: an attempt row whose `scoreDetail` is `{"strategy":"..."}` for MATH answers.

- [ ] **Step 1: Add the import**

```ts
import { checkMathAnswer } from "@/lib/math-answer";
```

- [ ] **Step 2: Add the branch**

Replace the grading block (currently lines 20-33) with:

```ts
  let isCorrect: boolean;
  let scoreDetail: Record<string, unknown> | null = null;
  let raw: RecallRaw;

  if (question.type === "MULTIPLE_CHOICE") {
    isCorrect = gradeMultipleChoice(answer, question.correctAnswer);
    raw = { kind: "QUIZ", correct: isCorrect };
  } else if (question.type === "MATH") {
    const grade = checkMathAnswer(answer, question.correctAnswer);
    isCorrect = grade.isCorrect;
    // Which strategy decided, so a miscalibrated one shows up in the data
    // rather than quietly inflating scores.
    scoreDetail = { strategy: grade.strategy };
    // The boolean form, like multiple choice. A math answer is right or wrong;
    // there is no partial credit to feed the interval, and inventing a
    // similarity for one would make the ledger lie.
    raw = { kind: "QUIZ", correct: isCorrect };
  } else {
    const grade = gradeShortAnswer(answer, question.correctAnswer);
    isCorrect = grade.isCorrect;
    scoreDetail = { similarity: grade.similarity };
    // The similarity, not the pass/fail: a half-right short answer should
    // shorten the interval without being scored as a blackout.
    raw = { kind: "QUIZ", similarity: grade.similarity };
  }
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors. If `question.type === "MATH"` is flagged as an impossible comparison, `npx prisma generate` from Task 5 did not run — run it.

- [ ] **Step 4: Run the whole suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/quiz/[questionId]/answer/route.ts"
git commit -m "feat: grade MATH quiz answers with the math checker"
```

---

### Task 7: The `MathQuestion` input

A value is not a paragraph, so this is a single-line input rather than the short answer's textarea, and its placeholder carries the notation contract.

**Files:**
- Create: `src/components/quiz/MathQuestion.tsx`
- Modify: `src/components/quiz/QuizRunner.tsx:10-15` (the `QuizQuestionForRunner` type) and its render branch
- Modify: `src/app/pages/[id]/page.tsx:222-229` (`sanitizeQuizQuestions`)
- Modify: `src/components/course/LessonRunner.tsx:11-18` and its `CHECK` scene branch

**Interfaces:**
- Consumes: `<Markdown>` from `@/components/Markdown`, `Input` and `Button` from the UI kit.
- Produces: `export function MathQuestion(props: { prompt: string; onSubmit: (answer: string) => void; disabled: boolean })` — the same prop shape as `ShortAnswerQuestion`, so the call sites are interchangeable.

- [ ] **Step 1: Write the component**

Create `src/components/quiz/MathQuestion.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

/**
 * A question whose answer is a value. One line rather than a textarea, because
 * an eigenvalue is not a paragraph, and a placeholder that states the notation
 * contract — the grader reads ASCII, and nothing else tells the student that.
 */
export function MathQuestion({
  prompt,
  onSubmit,
  disabled,
}: {
  prompt: string;
  onSubmit: (answer: string) => void;
  disabled: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const submit = () => onSubmit(answer);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg text-ink">
        <Markdown>{prompt}</Markdown>
      </div>
      <Input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && answer.trim() && !disabled) submit();
        }}
        disabled={disabled}
        aria-label="Your answer"
        placeholder="e.g. 1/2, x^2+1, [[1,2],[3,4]], {2,3,5}"
      />
      <Button onClick={submit} disabled={disabled || !answer.trim()} className="self-start">
        Submit
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Widen the runner's type and add its branch**

In `src/components/quiz/QuizRunner.tsx`, import the component and widen the type:

```tsx
import { MathQuestion } from "@/components/quiz/MathQuestion";
```

```tsx
export type QuizQuestionForRunner = {
  id: string;
  type: "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "CLOZE" | "MATH";
  prompt: string;
  options: string[] | null;
};
```

In the render branch, add `MATH` as the first case:

```tsx
        {question.type === "MATH" ? (
          <MathQuestion prompt={question.prompt} onSubmit={handleSubmit} disabled={submitting || !!feedback} />
        ) : question.type === "SHORT_ANSWER" ? (
```

- [ ] **Step 3: Widen the page's sanitizer**

In `src/app/pages/[id]/page.tsx`, in `sanitizeQuizQuestions`:

```tsx
  questions: { id: string; type: "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "CLOZE" | "MATH"; prompt: string; options: string | null }[]
```

- [ ] **Step 4: Add the branch to the lesson runner**

`src/components/course/LessonRunner.tsx` picks its check question with a `findFirst` that filters on no type, so a MATH question can reach it. Import the component, widen the type, and add the branch:

```tsx
import { MathQuestion } from "@/components/quiz/MathQuestion";
```

```tsx
type QuizQuestion = {
  id: string;
  type: "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "CLOZE" | "MATH";
  prompt: string;
  correctAnswer: string;
  options: string[] | null;
  explanation: string | null;
};
```

```tsx
            {quizQuestion.type === "MATH" ? (
              <MathQuestion
                prompt={quizQuestion.prompt}
                onSubmit={handleQuizSubmit}
                disabled={quizSubmitting || !!quizResult}
              />
            ) : quizQuestion.type === "SHORT_ANSWER" ? (
```

A `CLOZE` question still falls through to the multiple-choice branch with no options here. That is a pre-existing bug, it is not this plan's to fix, and widening the type makes it visible rather than causing it — leave it, and report it at the end.

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the whole suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/quiz/MathQuestion.tsx src/components/quiz/QuizRunner.tsx "src/app/pages/[id]/page.tsx" src/components/course/LessonRunner.tsx
git commit -m "feat: add a single-line input for math answers"
```

---

### Task 8: Render quiz prompts as math

Every quiz component interpolates its prompt into a `<p>` as plain text, so a question about an eigenvalue displays its LaTeX source. `<Markdown>` already carries `remark-math` and `rehype-katex`; the quiz never adopted it.

**Files:**
- Modify: `src/components/quiz/ShortAnswerQuestion.tsx:20`
- Modify: `src/components/quiz/MultipleChoiceQuestion.tsx`
- Modify: `src/components/quiz/ClozeQuestion.tsx:26-43`
- Modify: `src/components/quiz/QuizResultsSummary.tsx`

**Interfaces:**
- Consumes: `<Markdown>` from `@/components/Markdown`.
- Produces: nothing new.

- [ ] **Step 1: Swap the short answer prompt**

In `src/components/quiz/ShortAnswerQuestion.tsx`, add `import { Markdown } from "@/components/Markdown";` and replace `<p className="text-lg text-ink">{prompt}</p>` with:

```tsx
      <div className="text-lg text-ink">
        <Markdown>{prompt}</Markdown>
      </div>
```

- [ ] **Step 2: Swap the multiple choice prompt and its options**

In `src/components/quiz/MultipleChoiceQuestion.tsx`, add `import { Markdown } from "@/components/Markdown";`. A distractor is as likely to carry notation as the question is, so the option labels change too. The option's `<button>` keeps its `key`, `onClick`, `disabled` and classes exactly as they are; `[&_p]:m-0` flattens the paragraph `<Markdown>` puts inside it.

```tsx
      <div className="text-lg text-ink">
        <Markdown>{prompt}</Markdown>
      </div>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => setSelected(option)}
            disabled={disabled}
            className={clsx(
              "rounded-lg border px-4 py-2.5 text-left text-sm transition-colors [&_p]:m-0",
              selected === option
                ? "border-brand bg-brand-soft text-brand-ink"
                : "border-line bg-surface text-ink-soft hover:border-line-strong"
            )}
          >
            <Markdown>{option}</Markdown>
          </button>
        ))}
      </div>
```

- [ ] **Step 3: Swap the cloze prompt, keeping the input inline**

`ClozeQuestion` splits its prompt around the gap and needs the input inside the sentence, so the two fragments render through `<Markdown>` with the input between them. `<Markdown>` emits a block `<p>` per fragment, which would break the sentence across three lines — so the wrappers are made inline for this row:

```tsx
      <p className="text-lg leading-relaxed text-ink [&_p]:m-0 [&_p]:inline">
        <Markdown>{before}</Markdown>
        <Input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && answer.trim() && !disabled) submit();
          }}
          disabled={disabled}
          aria-label="Your answer for the blank"
          placeholder="…"
          className="mx-1 inline-block w-40 align-baseline"
        />
        <Markdown>{after}</Markdown>
      </p>
```

The `<p>` inside `<p>` this produces is invalid HTML — if React logs a nesting warning in the browser console, change the outer element to `<span className="block text-lg leading-relaxed text-ink [&_p]:m-0 [&_p]:inline">`.

- [ ] **Step 4: Swap the results summary**

In `src/components/quiz/QuizResultsSummary.tsx`, add `import { Markdown } from "@/components/Markdown";` and replace the four lines inside the `<li>`. The correct answer is the one that matters most: it is the reference notation, and showing `\frac{1}{2}` as source to a student who just got the question wrong is the worst moment to do it. Each row keeps its own colour, so the `<Markdown>` output is flattened in place rather than wrapped in one container.

```tsx
            <li key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 [&_p]:m-0">
              <div className="text-sm font-medium text-ink">
                <Markdown>{blankCloze(r.prompt)}</Markdown>
              </div>
              <div className="mt-1 flex gap-1 text-sm text-ink-soft">
                <span>Your answer:</span>
                <Markdown>{r.userAnswer}</Markdown>
              </div>
              <div className="flex gap-1 text-sm text-emerald-700">
                <span>Correct answer:</span>
                <Markdown>{r.correctAnswer}</Markdown>
              </div>
              {r.explanation && (
                <div className="mt-1 text-sm text-muted">
                  <Markdown>{r.explanation}</Markdown>
                </div>
              )}
            </li>
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: See it in the browser**

```bash
npm run dev
```

Open a page that has a quiz, run it, and confirm:
- A prompt containing `$x^2$` renders as math, not as `$x^2$`.
- The cloze input still sits inline in its sentence, on one line.
- A MATH question shows the single-line input with the notation placeholder.
- Answering a MATH question in a different notation than the reference — typing `0.5` where the answer is `1/2` — is marked correct.

Report what you saw. If the database holds no MATH question yet, regenerate a quiz on a page whose notes contain mathematics first.

- [ ] **Step 7: Run the whole suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/quiz/
git commit -m "feat: render quiz prompts and answers as math"
```

---

## Verification

After Task 8, before opening the PR:

- [ ] `npm test` — full suite green, with the new `latex-ascii`, `math-answer`, and `validation` files in the count.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — clean.
- [ ] `npm run build` — the production build compiles.
- [ ] Manual: the four checks from Task 8 Step 6, with real numbers for the PR description — how many questions were generated, which notations were accepted.
