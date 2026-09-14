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
