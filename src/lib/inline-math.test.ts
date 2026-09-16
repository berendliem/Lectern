import { test } from "node:test";
import assert from "node:assert/strict";
import { protectCurrency } from "./inline-math.ts";

test("a pair of prices is escaped so remark-math cannot pair them", () => {
  assert.equal(
    protectCurrency("The textbook costs $5 and the reader costs $10."),
    "The textbook costs \\$5 and the reader costs \\$10."
  );
});

test("a lone price is escaped too", () => {
  assert.equal(protectCurrency("Tuition rose to $1,200 this year."), "Tuition rose to \\$1,200 this year.");
});

test("math opening on a digit is left for remark-math", () => {
  const input = "Solve $5x^2 = 20$ for x.";
  assert.equal(protectCurrency(input), input);
});

test("math opening on a letter is never touched", () => {
  const input = "Einstein wrote $E = mc^2$ on the board.";
  assert.equal(protectCurrency(input), input);
});

test("a displayed equation survives untouched", () => {
  const input = "$$\n\\int_0^1 x^2 dx\n$$";
  assert.equal(protectCurrency(input), input);
});

test("markdown with no dollars at all is returned unchanged", () => {
  const input = "## Heading\n\n- a bullet\n- another";
  assert.equal(protectCurrency(input), input);
});

test("plain arithmetic opening on a digit is left for remark-math", () => {
  for (const input of ["$5-1$", "$5 - 1$", "$2 * 3$", "$6/2$", "$5x+1$"]) {
    assert.equal(protectCurrency(input), input);
  }
});

test("price ranges and sums are still escaped", () => {
  assert.equal(protectCurrency("It costs $5-$10."), "It costs \\$5-\\$10.");
  assert.equal(protectCurrency("Between $5-10 and $20."), "Between \\$5-10 and \\$20.");
  assert.equal(protectCurrency("$5 + $10 in total"), "\\$5 + \\$10 in total");
});
