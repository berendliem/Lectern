/**
 * Model output for a diagram arrives in three shapes: bare mermaid source, source
 * wrapped in a ```mermaid fence, or prose apologising that no diagram fits. Only the
 * first two are usable, and a diagram is optional everywhere it appears — return null
 * rather than handing the renderer something that will throw.
 */
const DIAGRAM_TYPES =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart)\b/i;

/**
 * `%%{init: ...}%%` blocks are mermaid's inline config directives. Mermaid finds them
 * anywhere in the source, not only at the top, and refuses to let them change
 * securityLevel — but it does let them set `themeCSS`, whose only validation is that
 * the braces balance. That CSS lands in the page's own DOM, where a `position: fixed`
 * rule can cover the viewport and a `url(...)` can call an attacker's host. The
 * diagram source is model output derived from a transcript nobody vetted, so no
 * directive is worth allowing: a diagram carrying one is dropped whole.
 */
const DIRECTIVE = /%%\{/;

/** Well past the 7-node diagram we ask for, well under mermaid's own 50k parse cap. */
const MAX_LENGTH = 4000;

export function cleanMermaid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const unfenced = raw
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  if (!DIAGRAM_TYPES.test(unfenced)) return null;
  if (DIRECTIVE.test(unfenced)) return null;
  if (unfenced.length > MAX_LENGTH) return null;
  return unfenced;
}
