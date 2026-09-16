import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/components/Markdown";

const render = (markdown: string) => renderToStaticMarkup(createElement(Markdown, null, markdown));

test("inline LaTeX renders as math rather than literal dollar signs", () => {
  const html = render("Einstein wrote $E = mc^2$ on the board.");
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /\$E = mc\^2\$/);
});

test("a displayed equation renders as a math block", () => {
  const html = render("$$\n\\int_0^1 x^2 dx\n$$");
  assert.match(html, /katex-display/);
});

test("prices in prose are left alone", () => {
  const html = render("The textbook costs $5 and the reader costs $10.");
  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /\$5/);
  assert.match(html, /\$10/);
});

test("a coefficient is still math, even though it opens on a digit", () => {
  const html = render("Solve $5x^2 = 20$ for x.");
  assert.match(html, /class="katex"/);
});

test("tables still render, so adding math did not cost us GFM", () => {
  const html = render("| a | b |\n| - | - |\n| 1 | 2 |");
  assert.match(html, /<table>/);
});

test("a dollar amount inside fenced code is left exactly as written", () => {
  const html = render("```mermaid\nflowchart TD\n  A[Buy for $5] --> B[Sell for $10]\n```");
  assert.match(html, /Buy for \$5\]/);
  assert.doesNotMatch(html, /\\\$5/);
});
