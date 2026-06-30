import type { TranscriptSegment } from "@/types";

export function TranscriptView({
  rawText,
  segments,
}: {
  rawText: string;
  segments: TranscriptSegment[];
}) {
  if (segments.length === 0) {
    return <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{rawText}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {segments.map((segment, i) => (
        <div key={i} className="flex gap-3 text-sm leading-6">
          <span className="w-14 shrink-0 font-mono text-xs text-slate-400">
            {formatTimestamp(segment.start)}
          </span>
          <span className="text-slate-700">{segment.text}</span>
        </div>
      ))}
    </div>
  );
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
