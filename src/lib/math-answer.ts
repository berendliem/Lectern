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
export const safeMath = create(all);

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

/** Tasks 3 and 4 append to this list, in order. */
export const STRATEGIES: Strategy[] = [numericStrategy, collectionStrategy, probeStrategy];

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
