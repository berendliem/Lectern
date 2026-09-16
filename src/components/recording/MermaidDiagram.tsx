"use client";

import { useEffect, useState } from "react";

let idCounter = 0;
let initialized = false;

/**
 * Renders model-written Mermaid source. Mermaid is ~2MB, so it loads on first use
 * rather than with the recording panel. Broken source is the normal case, not the
 * exception — smaller models write invalid diagrams often — so a parse failure
 * renders nothing and leaves the explanation text standing on its own.
 */
export function MermaidDiagram({ source }: { source: string }) {
  // Tagged with the source it came from, so a diagram from the previous "Explain this"
  // never lingers under a newer explanation while the next one renders.
  const [rendered, setRendered] = useState<{ source: string; svg: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        // initialize() writes global config, so it runs once rather than per diagram.
        if (!initialized) {
          // htmlLabels puts <foreignObject> HTML in the SVG. Plain SVG text labels
          // are enough for a 7-node diagram and keep that element out of the page.
          mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            securityLevel: "strict",
            htmlLabels: false,
            flowchart: { htmlLabels: false },
            // On a parse error mermaid otherwise draws its own error diagram into
            // a div it appended to <body> and throws without removing it — one
            // stray node per failed "Explain this", outside React's tree.
            suppressErrorRendering: true,
          });
          initialized = true;
        }
        const { svg } = await mermaid.render(`live-explain-${idCounter++}`, source);
        if (!cancelled) setRendered({ source, svg });
      } catch (e) {
        // Invalid diagram: leave the explanation text to stand on its own. Logged
        // because a silent drop is otherwise indistinguishable from the model
        // correctly deciding the concept needs no diagram.
        console.warn("Mermaid diagram failed to render", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (rendered?.source !== source) return null;
  const svg = rendered.svg;

  // Mermaid's own output, rendered with securityLevel "strict" — it sanitises the
  // labels the model wrote rather than trusting them into the DOM.
  return (
    <div
      role="img"
      aria-label="Diagram of the text above"
      className="mt-3 overflow-x-auto rounded-lg bg-surface p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
