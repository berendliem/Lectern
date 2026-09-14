import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMathAnswer, parseOrNull, evaluateOrNull } from "./math-answer.ts";

test("an identical answer is correct", () => {
  assert.deepEqual(checkMathAnswer("42", "42"), { isCorrect: true, strategy: "canonical" });
});

test("notation that no evaluator can read is compared as a string", () => {
  assert.deepEqual(checkMathAnswer("\\det(A) = 0", "det(A)=0"), {
    isCorrect: true,
    strategy: "canonical",
  });
  assert.deepEqual(checkMathAnswer("\\mathbb{R}^3", "  \\mathbb{R}^3  "), {
    isCorrect: true,
    strategy: "canonical",
  });
  assert.deepEqual(checkMathAnswer("\\mathbb{R}^3", "\\mathbb{R}^2"), {
    isCorrect: false,
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

test("a student expression cannot reach mathjs's risky functions", () => {
  // Disabled at the namespace, so the symbol resolves to a thrower and the
  // evaluation declines. With `parse` enabled this returns a Node instead.
  const node = parseOrNull('parse("2+3")');
  assert.notEqual(node, null);
  assert.equal(evaluateOrNull(node!), null);

  const unitNode = parseOrNull('createUnit("furlong")');
  assert.notEqual(unitNode, null);
  assert.equal(evaluateOrNull(unitNode!), null);
});

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

test("a student answer cannot reconfigure the grader for the answers after it", () => {
  // `config` mutates the module-level mathjs instance for the life of the
  // process. Before it was disabled, this one answer switched every later
  // evaluation to BigNumber, so the `typeof value !== "number"` guards
  // declined forever and everything below graded by string comparison.
  checkMathAnswer('config({number:"BigNumber"})', "5");

  assert.deepEqual(checkMathAnswer("1/2", "0.5"), { isCorrect: true, strategy: "numeric" });
  assert.deepEqual(checkMathAnswer("[[1/2,2],[3,4]]", "[[0.5,2],[3,4]]"), {
    isCorrect: true,
    strategy: "collection",
  });
  assert.deepEqual(checkMathAnswer("(x+1)^2", "x^2+2x+1"), {
    isCorrect: true,
    strategy: "probe",
  });
});
