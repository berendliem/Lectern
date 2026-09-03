import type { TranscriptSegment } from "@/types";

function pad(n: number, len = 2): string {
  return Math.floor(n).toString().padStart(len, "0");
}

function formatTime(totalSeconds: number, msSeparator: "," | "."): string {
  // Round to total milliseconds first so a fraction like .9995 carries into
  // the seconds instead of producing a 4-digit millisecond field.
  const totalMs = Math.max(0, Math.round(totalSeconds * 1000));
  const millis = totalMs % 1000;
  const wholeSec = Math.floor(totalMs / 1000);
  const hours = Math.floor(wholeSec / 3600);
  const minutes = Math.floor((wholeSec % 3600) / 60);
  const seconds = wholeSec % 60;
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

/**
 * WebVTT subtitle file from transcript segments. Attribution is written as a
 * `<v Name>` voice tag so a Teams export round-trips through import and back
 * out with its speakers intact. SubRip has no equivalent, so buildSrt drops
 * them.
 */
export function buildVtt(segments: TranscriptSegment[]): string {
  const cues = segments
    .map((seg) => {
      const text = seg.text.trim();
      // ">" would close the voice tag early; the name is user-supplied.
      const speaker = seg.speaker?.trim().replace(/>/g, "");
      const body = speaker ? `<v ${speaker}>${text}</v>` : text;
      return `${formatTime(seg.start, ".")} --> ${formatTime(seg.end, ".")}\n${body}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${cues}`;
}
