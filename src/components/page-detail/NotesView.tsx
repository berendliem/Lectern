import ReactMarkdown from "react-markdown";
import type { KeyTerm } from "@/types";

export function NotesView({ markdown, keyTerms }: { markdown: string; keyTerms: KeyTerm[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="prose prose-slate prose-sm max-w-none prose-headings:font-semibold prose-h1:text-xl prose-h2:text-lg">
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
      {keyTerms.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Key terms</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {keyTerms.map((kt) => (
              <div key={kt.term} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-900">{kt.term}</p>
                <p className="text-sm text-slate-600">{kt.definition}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
