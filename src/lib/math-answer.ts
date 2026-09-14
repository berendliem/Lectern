import { create, all, type MathNode } from "mathjs";
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
const DISABLED = ["import", "createUnit", "reviver", "simplify", "derivative", "resolve"];
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
