import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { KeyTerm } from "@/types";

export function NotesView({
  markdown,
  keyTerms,
  proseRef,
}: {
  markdown: string;
  keyTerms: KeyTerm[];
  /** The read-aloud bar walks this subtree for the text it speaks. */
  proseRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div
        ref={proseRef}
        className="prose prose-zinc prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-h1:text-xl prose-h2:text-lg prose-table:text-sm"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
      {keyTerms.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Key terms</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {keyTerms.map((kt) => (
              <div key={kt.term} className="rounded-xl border border-lavender-soft bg-lavender-soft/40 p-3">
                <p className="text-sm font-medium text-ink">{kt.term}</p>
                <p className="text-sm text-ink-soft">{kt.definition}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
