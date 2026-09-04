"use client";

import { Fragment, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import clsx from "@/lib/clsx";
import type { Chapter, TranscriptSegment } from "@/types";

const SPEEDS = [1, 1.25, 1.5, 2];

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Audio player synced to the transcript: clicking a segment seeks the audio
 * to that timestamp, and the segment being spoken is highlighted live.
 */
export function SyncedTranscriptPlayer({
  src,
  segments,
  chapters = [],
}: {
  src: string;
  segments: TranscriptSegment[];
  chapters?: Chapter[];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);

  // Last segment whose start we've passed; -1 before the first segment.
  const activeIndex = (() => {
    let idx = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].start <= currentTime + 0.15) idx = i;
      else break;
    }
    return idx;
  })();

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play();
    else audio.pause();
  }

  function seekTo(seconds: number, play = false) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
    if (play) audio.play();
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  // Until real metadata arrives (streamed audio may briefly report Infinity),
  // approximate the total from the last segment's end so the bar is usable.
  const lastEnd = segments.length ? segments[segments.length - 1].end : 0;
  const effectiveDuration = Number.isFinite(duration) && duration > 0 ? duration : lastEnd;
  const progress = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;

  return (
    <div className="flex flex-col gap-4">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          setCurrentTime(e.currentTarget.currentTime);
          // Streamed audio can first report an Infinity duration and correct
          // itself later without another durationchange; re-check here.
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0 && d !== duration) setDuration(d);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
      />

      {/* Player bar */}
      <div className="flex items-center gap-3 rounded-xl border border-line/80 bg-surface px-4 py-3">
        <button
          onClick={toggle}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full grad-brand text-white shadow-brand transition-transform hover:scale-105 active:scale-95"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <Pause className="h-4 w-4" strokeWidth={2.4} />
          ) : (
            <Play className="ml-0.5 h-4 w-4" strokeWidth={2.4} />
          )}
        </button>

        <span className="w-10 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-muted">
          {fmt(currentTime)}
        </span>

        <input
          type="range"
          min={0}
          max={effectiveDuration || 0}
          step={0.1}
          value={Math.min(currentTime, effectiveDuration || 0)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Seek"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-brand"
          style={{
            background: `linear-gradient(to right, var(--color-brand) ${progress * 100}%, var(--line) ${progress * 100}%)`,
          }}
        />

        <span className="w-10 shrink-0 font-mono text-[11.5px] tabular-nums text-muted-2">{fmt(effectiveDuration)}</span>

        <button
          onClick={cycleSpeed}
          className="shrink-0 rounded-lg border border-line px-2 py-1 font-mono text-[11.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2"
          aria-label="Playback speed"
        >
          {SPEEDS[speedIndex]}×
        </button>
      </div>

      {/* Chapter chips: jump to a topic section (AI-detected) */}
      {chapters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chapters.map((chapter, i) => {
            const active =
              currentTime >= chapter.startSec &&
              (currentTime < chapter.endSec || i === chapters.length - 1);
            return (
              <button
                key={i}
                onClick={() => seekTo(chapter.startSec, true)}
                className={clsx(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  active
                    ? "border-transparent bg-brand-soft text-brand"
                    : "border-line text-ink-soft hover:border-line-strong hover:bg-surface-2"
                )}
              >
                <span className="font-mono text-[11px] text-muted-2">{fmt(chapter.startSec)}</span>
                {i + 1}. {chapter.title}
              </button>
            );
          })}
        </div>
      )}

      {/* Clickable, live-highlighted transcript */}
      <div className="flex flex-col gap-0.5">
        {segments.map((segment, i) => (
          // Label only when the speaker changes, matching TranscriptView — an
          // imported transcript keeps its attribution once audio is attached.
          <Fragment key={i}>
            {!!segment.speaker && segment.speaker !== segments[i - 1]?.speaker && (
              <span className="pl-[4.75rem] text-[12.5px] font-semibold text-brand">
                {segment.speaker}
              </span>
            )}
          <button
            onClick={() => seekTo(segment.start, true)}
            className={clsx(
              "flex gap-3 rounded-lg px-2 py-1.5 text-left text-sm leading-6 transition-colors",
              i === activeIndex ? "bg-brand-soft/70" : "hover:bg-surface-2"
            )}
          >
            <span
              className={clsx(
                "w-14 shrink-0 font-mono text-xs leading-6",
                i === activeIndex ? "font-semibold text-brand" : "text-muted-2"
              )}
            >
              {fmt(segment.start)}
            </span>
            <span className={clsx(i === activeIndex ? "text-ink" : "text-ink-soft")}>{segment.text}</span>
          </button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
