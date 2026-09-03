import type { TranscriptSegment } from "@/types";

export function TranscriptView({
  rawText,
  segments,
}: {
  rawText: string;
  segments: TranscriptSegment[];
}) {
  if (segments.length === 0) {
    return <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">{rawText}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {segments.map((segment, i) => {
        // Label only when the speaker changes: a name on every line of a
        // 400-cue Teams transcript is noise, not information.
        const showSpeaker = !!segment.speaker && segment.speaker !== segments[i - 1]?.speaker;
        return (
          <div key={i} className="flex flex-col gap-0.5">
            {showSpeaker && (
              <span className="pl-[4.25rem] text-[12.5px] font-semibold text-brand">
                {segment.speaker}
              </span>
            )}
            <div className="flex gap-3 text-sm leading-6">
              <span className="w-14 shrink-0 font-mono text-xs text-zinc-400">
                {formatTimestamp(segment.start)}
              </span>
              <span className="text-zinc-700">{segment.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
