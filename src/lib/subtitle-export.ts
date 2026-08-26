import type { TranscriptSegment } from "@/types";

function pad(n: number, len = 2): string {
  return Math.floor(n).toString().padStart(len, "0");
}

function formatTime(totalSeconds: number, msSeparator: "," | "."): string {
  const s = Math.max(0, totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = Math.floor(s % 60);
  const millis = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${msSeparator}${pad(millis, 3)}`;
}

/** SubRip subtitle file from transcript segments. */
export function buildSrt(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${formatTime(seg.start, ",")} --> ${formatTime(seg.end, ",")}\n${seg.text.trim()}\n`
    )
    .join("\n");
}

/** WebVTT subtitle file from transcript segments. */
export function buildVtt(segments: TranscriptSegment[]): string {
  const cues = segments
    .map((seg) => `${formatTime(seg.start, ".")} --> ${formatTime(seg.end, ".")}\n${seg.text.trim()}\n`)
    .join("\n");
  return `WEBVTT\n\n${cues}`;
}
