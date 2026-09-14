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
