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

// Captured before the override below: `parseOrNull` needs the real parser,
// and disabling `parse` on the namespace is what keeps a student-typed
// expression from reaching it. mathjs's own security guidance is to take
// the reference first and disable afterwards.
const parseExpression = safeMath.parse.bind(safeMath);

// The eight names mathjs's security note publishes, plus `config` and `chain`.
// `config` is the one that bites: it is reachable from a student-typed
// expression and it mutates this module-level instance for the life of the
// process, so one answer of `config({number:"BigNumber"})` makes every later
// evaluation return a BigNumber, every `typeof value !== "number"` guard
// decline, and every MATH question after it grade by string comparison alone.
const DISABLED = [
  "import", "createUnit", "reviver", "evaluate", "parse", "simplify", "derivative", "resolve",
  "config", "chain",
];
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

function numbersEqual(a: number, b: number): boolean {
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
    return parseExpression(text);
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
  // The backslash goes too: `latexToAscii` leaves a command it does not know
  // intact, and a student who types `det(A)=0` for a reference of `\det(A)=0`
  // has written the same answer.
  return text.replace(/\s+/g, "").replace(/\\/g, "").replace(/\*/g, "·").toLowerCase();
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

/**
 * ponytail: number leaves only, here and in `parseSet`. mathjs's Complex is
 * not a number to `typeof`, so `{i,-i}` or a rotation matrix's eigenvalues
 * decline in every evaluator strategy and fall through to the string
 * comparison, which marks them wrong unless the student typed the reference
 * verbatim. Teach both helpers Complex the first time a course asks for one.
 */
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

/** Five points is decisive for an answer box: two different polynomials agree at finitely many. */
const PROBE_POINTS = 5;
/** Magnitude, away from 0 and 1 where x, x^2 and sqrt(x) all agree. Non-integer, so lattice coincidences do not bite. */
const PROBE_MIN = 1.5;
const PROBE_MAX = 9.5;
/**
 * A pole, a log of a negative or a root of one discards the point and draws
 * again, so the budget is sized for the worst honest case rather than the
 * average one: an expression defined on only a slice of the sample range —
 * `sqrt(x-8)` is live on about a tenth of it — needs a lot of draws to find
 * five valid points. Spending them is cheaper than declining, because
 * declining grades a correct answer wrong. Raising the budget cannot hide a
 * disagreement a smaller one would have found: the loop halts at the fifth
 * agreement, and any point where both sides evaluate to finite reals and
 * differ returns false immediately. It does widen what the loop gets to see
 * — see the ponytail note on `probeStrategy`.
 */
const MAX_DRAWS = PROBE_POINTS * 40;

/**
 * Hashes both sides into a seed. FNV-1a is four lines and spreads a
 * one-character difference across the whole word, which is all that is asked
 * of it: an unrelated pair must walk an unrelated sequence. The separator is
 * a NUL because it cannot occur in either side, so `("ab", "c")` and
 * `("a", "bc")` cannot collide.
 */
function seedFrom(user: string, correct: string): number {
  const text = `${user}\u0000${correct}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32, seeded per comparison. The draws stay pseudo-random in
 * character; what changes is that the same pair of answers always walks the
 * same sequence, so the verdict is a property of the answers rather than of
 * when the student pressed submit. Grading off `Math.random()` graded
 * `sqrt(x-8)+1` against `1+sqrt(x-8)` correct 15 times in 20 and wrong 5.
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/**
 * ponytail: agreement at five points is evidence, not proof. Two different
 * expressions that happen to coincide on every sample are declared equal, and
 * more samples narrow that gap without closing it — including the shape a
 * sampler cannot see at all, two expressions that agree everywhere both are
 * defined and differ only where one of them is non-real, which this loop
 * skips as a domain error (`sqrt(x-8)` against `sqrt(abs(x-8))`). A real CAS
 * — or mathjs's own `simplify`, disabled here as untrusted-input surface —
 * is the upgrade if a course ever produces a pair that collides.
 */
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

    const random = mulberry32(seedFrom(user, correct));

    let agreements = 0;
    for (let draw = 0; draw < MAX_DRAWS && agreements < PROBE_POINTS; draw++) {
      const scope: Record<string, number> = {};
      for (const name of userVariables) {
        // The sign is drawn as well as the magnitude. A positive-only sample
        // is the same class of coincidence as sampling 0 and 1: it declares
        // abs(x) equal to x, and sqrt(x^2) equal to x.
        const magnitude = PROBE_MIN + random() * (PROBE_MAX - PROBE_MIN);
        scope[name] = random() < 0.5 ? -magnitude : magnitude;
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

/** Tried in order: the cheapest verdict first, the one that samples last. */
const STRATEGIES: readonly Strategy[] = [numericStrategy, collectionStrategy, probeStrategy];

export function checkMathAnswer(userAnswer: string, correctAnswer: string): MathGrade {
  // The cap sits above the converter, not below it: `latexToAscii` scans the
  // string and recurses into every group it finds, so a runaway input must
  // not reach it either. The string comparison still runs, so past the cap
  // there is a verdict rather than a crash.
  const withinCap = userAnswer.length <= MAX_LENGTH && correctAnswer.length <= MAX_LENGTH;
  const user = withinCap ? latexToAscii(userAnswer) : userAnswer;
  const correct = withinCap ? latexToAscii(correctAnswer) : correctAnswer;

  if (canonicalise(user) === canonicalise(correct) && correct.length > 0) {
    return { isCorrect: true, strategy: "canonical" };
  }

  if (withinCap) {
    for (const strategy of STRATEGIES) {
      const verdict = strategy.decide(user, correct);
      if (verdict !== null) return { isCorrect: verdict, strategy: strategy.name };
    }
  }

  return { isCorrect: false, strategy: "canonical" };
}
