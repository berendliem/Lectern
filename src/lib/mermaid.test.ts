import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMermaid } from "./mermaid";

test("cleanMermaid keeps bare and fenced diagrams", () => {
  assert.equal(cleanMermaid("flowchart TD\n  A --> B"), "flowchart TD\n  A --> B");
  assert.equal(cleanMermaid("```mermaid\nflowchart TD\n  A --> B\n```"), "flowchart TD\n  A --> B");
  assert.equal(cleanMermaid("  sequenceDiagram\n  A->>B: hi  "), "sequenceDiagram\n  A->>B: hi");
  assert.equal(cleanMermaid("Flowchart TD\n  A --> B"), "Flowchart TD\n  A --> B");
});

test("cleanMermaid rejects anything that is not a diagram", () => {
  assert.equal(cleanMermaid("Sorry, no diagram fits this explanation."), null);
  assert.equal(cleanMermaid(""), null);
  assert.equal(cleanMermaid(undefined), null);
  assert.equal(cleanMermaid("graphic design is my passion"), null);
});

test("cleanMermaid rejects config directives hidden after a valid opening line", () => {
  // Mermaid honours a directive anywhere in the source, so checking only the first
  // line is not enough. themeCSS reaches the page's own DOM: a fixed-position rule
  // covers the viewport, and url() calls out to whatever host it names.
  const overlay =
    'flowchart TD\n  A --> B\n%%{init: {"themeCSS": "foreignobject{position:fixed;top:0;left:0;width:100vw;height:100vh;background:url(https://attacker.example/beacon)}"}}%%';
  assert.equal(cleanMermaid(overlay), null);
  assert.equal(cleanMermaid('%%{init: {"theme":"dark"}}%%\nflowchart TD\n  A --> B'), null);
});

test("cleanMermaid rejects a diagram longer than the cap", () => {
  assert.equal(cleanMermaid(`flowchart TD\n${"  A --> B\n".repeat(500)}`), null);
});
