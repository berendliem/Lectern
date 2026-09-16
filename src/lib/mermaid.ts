/**
 * Model output for a diagram arrives in three shapes: bare mermaid source, source
 * wrapped in a ```mermaid fence, or prose apologising that no diagram fits. Only the
 * first two are usable, and a diagram is optional everywhere it appears — return null
 * rather than handing the renderer something that will throw.
 */
// The two shapes the prompt asks for. Each diagram type is its own renderer with
// its own sinks; the allowlist stays as small as the feature.
const DIAGRAM_TYPES = /^(flowchart|graph|sequenceDiagram)\b/i;

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

/**
 * Ordinary statements that reach the same sinks without a directive. `style`,
 * `classDef` and `linkStyle` become an inline `style` attribute on the node, which
 * DOMPurify keeps and never parses, so the same fixed-position overlay and `url()`
 * beacon go through them. `click`, `link`, `links` and a sequence diagram's
 * `details` wrap a node in a real `<a>` to any host, and `properties` sets an
 * `<image>` href: sanitizeUrl strips `javascript:`, not phishing or beacons.
 * `accTitle` and `accDescr` write free text into the SVG outside any node label.
 * A statement may follow `;` on the same line, so a line anchor alone misses it.
 */
const STATEMENT = /(^|;)\s*(style|classDef|linkStyle|click|links?|details|properties|accTitle|accDescr)\b/im;

/**
 * A sequence diagram hands `$$…$$` to KaTeX and inserts the result into a
 * foreignObject through innerHTML — a path `htmlLabels: false` does not close.
 */
const KATEX = /\$\$/;

/** Invisible format characters, such as a zero-width space ahead of a keyword, slip past STATEMENT's anchor. */
const FORMAT_CHARACTER = /\p{Cf}/u;

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
  if (STATEMENT.test(unfenced)) return null;
  if (KATEX.test(unfenced) || FORMAT_CHARACTER.test(unfenced)) return null;
  if (unfenced.length > MAX_LENGTH) return null;
  return unfenced;
}
