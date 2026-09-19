// src/components/interview/live/LiveTranscript.tsx
"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import clsx from "@/lib/clsx";
import { transcriptMarkdown, type FixCard, type TranscriptLine } from "@/lib/live-transcript";

function fileName(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "interview"}.md`;
}

/**
 * The end of a spoken session: what was said, and a study sheet of every
 * miss with its correction and example — the part worth rereading.
 */
export function LiveTranscript({ title, lines, cards }: { title: string; lines: TranscriptLine[]; cards: FixCard[] }) {
  const [copied, setCopied] = useState(false);
  const markdown = transcriptMarkdown(title, lines, cards);

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin or denied); the download still works.
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(title);
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? <Check className="h-4 w-4" strokeWidth={2} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
          {copied ? "Copied" : "Copy as Markdown"}
        </Button>
        <Button variant="secondary" size="sm" onClick={download}>
          <Download className="h-4 w-4" strokeWidth={2} />
          Download .md
        </Button>
      </div>

      <section aria-labelledby="fix-heading" className="flex flex-col gap-3">
        <h2 id="fix-heading" className="text-base font-semibold text-ink">
          What to fix
        </h2>
        {cards.length === 0 ? (
          <p className="text-sm text-muted">Nothing to fix — every answer landed.</p>
        ) : (
          cards.map((card, i) => (
            <article key={i} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
              <p className="text-sm font-semibold text-ink">{card.question}</p>
              <p className="text-[13.5px] text-muted">
                <span className="font-medium text-ink-soft">You said: </span>
                {card.answer}
              </p>
              {card.correction && (
                <p className="text-[13.5px] text-ink">
                  <span className="font-medium">Correction: </span>
                  {card.correction}
                </p>
              )}
              {card.example && (
                <p className="rounded-lg bg-brand-soft/50 px-3 py-2 text-[13.5px] text-ink">
                  <span className="font-medium">Example: </span>
                  {card.example}
                </p>
              )}
              {card.retry && (
                <p className="text-[13px] text-muted">
                  <span className="font-medium text-ink-soft">Your retry ({card.retry.verdict}): </span>
                  {card.retry.answer}
                </p>
              )}
            </article>
          ))
        )}
      </section>

      <section aria-labelledby="conversation-heading" className="flex flex-col gap-3">
        <h2 id="conversation-heading" className="text-base font-semibold text-ink">
          Conversation
        </h2>
        <ol className="flex flex-col gap-3">
          {lines.map((line, i) => (
            <li key={i} className={clsx("flex flex-col gap-0.5", line.speaker === "You" && "items-end text-right")}>
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-2">{line.speaker}</span>
              <p
                className={clsx(
                  "max-w-[85%] rounded-xl px-3 py-2 text-[14px]",
                  line.speaker === "You" ? "bg-brand-soft text-ink" : "bg-surface-2 text-ink"
                )}
              >
                {line.text}
                {line.interrupted && <span className="text-muted-2"> — (you cut in)</span>}
                {line.source === "browser" && <span className="block text-[11.5px] text-muted-2">browser transcript</span>}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
