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

test("cleanMermaid rejects style and link statements, which reach the same sinks", () => {
  // `style` lands as an inline style attribute DOMPurify keeps verbatim: the
  // overlay needs no directive at all. A protocol-relative url() survives the
  // colon split mermaid does on each declaration.
  assert.equal(
    cleanMermaid(
      "flowchart TD\n  A --> B\n  style A position:fixed,top:0,width:100vw,height:100vh,background:url(//attacker.example/b)"
    ),
    null
  );
  assert.equal(cleanMermaid("flowchart TD\n  A --> B\n  classDef x position:fixed\n  class A x"), null);
  assert.equal(cleanMermaid("flowchart TD\n  A --> B\n  linkStyle 0 stroke:red"), null);
  assert.equal(cleanMermaid('flowchart TD\n  A[Open the slides] --> B\n  click A "https://attacker.example/phish"'), null);
  assert.equal(cleanMermaid("sequenceDiagram\n  A->>B: hi\n  link A: Slides @ https://attacker.example"), null);
  assert.equal(cleanMermaid("sequenceDiagram\n  A->>B: hi\n  links A: {\"Slides\": \"https://attacker.example\"}"), null);
  // A node label that merely contains the word is not a statement.
  assert.equal(cleanMermaid("flowchart TD\n  A[Click to style] --> B"), "flowchart TD\n  A[Click to style] --> B");
});

test("cleanMermaid keeps only the diagram types the prompt asks for", () => {
  assert.equal(cleanMermaid("pie\n  \"A\" : 1"), null);
  assert.equal(cleanMermaid("classDiagram\n  class A"), null);
  assert.equal(cleanMermaid("graph LR\n  A --> B"), "graph LR\n  A --> B");
});

test("cleanMermaid rejects a diagram longer than the cap", () => {
  assert.equal(cleanMermaid(`flowchart TD\n${"  A --> B\n".repeat(500)}`), null);
});
