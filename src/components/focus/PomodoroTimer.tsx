"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Coffee, Pause, Play, RotateCcw, Settings2, SkipForward, Sparkles, Timer } from "lucide-react";
import clsx from "@/lib/clsx";

type Phase = "focus" | "short" | "long";

type Settings = {
  focus: number; // minutes
  short: number;
  long: number;
  longEvery: number; // focus sessions before a long break
  autoStart: boolean;
};

const DEFAULT_SETTINGS: Settings = { focus: 25, short: 5, long: 15, longEvery: 4, autoStart: true };

const PHASE_META: Record<Phase, { label: string; blurb: string; pill: string; grad: string; stops: [string, string] }> = {
  focus: {
    label: "Focus",
    blurb: "Deep work — one task, no tabs.",
    pill: "bg-brand-soft text-brand",
    grad: "grad-focus",
    stops: ["#7c3aed", "#db2777"],
  },
  short: {
    label: "Short break",
    blurb: "Stretch, sip water, look away from the screen.",
    pill: "bg-moss-soft text-moss-ink",
    grad: "grad-short",
    stops: ["#059669", "#34d399"],
  },
  long: {
    label: "Long break",
    blurb: "You earned it — step away for a bit.",
    pill: "bg-sky-soft text-sky-ink",
    grad: "grad-long",
    stops: ["#0284c7", "#38bdf8"],
  },
};

const S_KEY = "pomodoro.settings";
const CT_KEY = "pomodoro.completedToday";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(S_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return {
      focus: clampMinutes(o.focus, DEFAULT_SETTINGS.focus),
      short: clampMinutes(o.short, DEFAULT_SETTINGS.short),
      long: clampMinutes(o.long, DEFAULT_SETTINGS.long),
      longEvery: clampInt(o.longEvery, 2, 8, DEFAULT_SETTINGS.longEvery),
      autoStart: typeof o.autoStart === "boolean" ? o.autoStart : DEFAULT_SETTINGS.autoStart,
    };
  } catch {
    return null;
  }
}

function loadCompletedToday(): number {
  try {
    const raw = localStorage.getItem(CT_KEY);
    if (!raw) return 0;
    const o = JSON.parse(raw);
    return o.date === todayKey() ? Number(o.count) || 0 : 0;
  } catch {
    return 0;
  }
}

function clampMinutes(v: unknown, fallback: number): number {
  return clampInt(v, 1, 120, fallback);
}
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function durationSeconds(phase: Phase, s: Settings): number {
  return (phase === "focus" ? s.focus : phase === "short" ? s.short : s.long) * 60;
}

function fmt(total: number): string {
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${`${sec}`.padStart(2, "0")}`;
}

function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.start(t);
      osc.stop(t + 0.42);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 1200);
  } catch {
    // Audio is a nicety; never let it break the timer.
  }
}

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    }
  } catch {
    // Ignore — notifications are best-effort.
  }
}

const RADIUS = 130;
const CIRC = 2 * Math.PI * RADIUS;

export function PomodoroTimer({
  /** The lecture this session is for, when the timer was opened from one. */
  lecture,
}: {
  lecture?: { id: string; title: string };
} = {}) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [phase, setPhase] = useState<Phase>("focus");
  const [remaining, setRemaining] = useState(DEFAULT_SETTINGS.focus * 60);
  const [running, setRunning] = useState(false);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [cycle, setCycle] = useState(0); // focus sessions completed this run
  const [completedToday, setCompletedToday] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const askedNotifyRef = useRef(false);
  const expireRef = useRef<() => void>(() => {});

  // Load persisted settings + today's tally once on the client. Deferred to a
  // microtask so the first client render still matches the server (defaults),
  // avoiding both a hydration mismatch and a synchronous setState-in-effect.
  useEffect(() => {
    queueMicrotask(() => {
      const s = loadSettings();
      if (s) {
        setSettings(s);
        setRemaining(s.focus * 60);
      }
      setCompletedToday(loadCompletedToday());
      setMounted(true);
    });
  }, []);

  // Reflect the countdown in the tab title while running.
  useEffect(() => {
    if (!mounted) return;
    document.title = running ? `${fmt(remaining)} — ${PHASE_META[phase].label}` : "Focus — Notetaker";
  }, [remaining, running, phase, mounted]);
  useEffect(() => () => {
    document.title = "Notetaker";
  }, []);

  function advance(countFocus: boolean) {
    playChime();
    const wasFocus = phase === "focus";
    let nextPhase: Phase;
    let nextCycle = cycle;

    if (wasFocus) {
      nextCycle = cycle + 1;
      nextPhase = nextCycle % settings.longEvery === 0 ? "long" : "short";
      if (countFocus) {
        const ct = completedToday + 1;
        setCompletedToday(ct);
        try {
          localStorage.setItem(CT_KEY, JSON.stringify({ date: todayKey(), count: ct }));
        } catch {
          // best-effort persistence
        }
        notify("Focus session complete 🎉", `Great work — time for a ${nextPhase === "long" ? "long" : "short"} break.`);
      }
    } else {
      nextPhase = "focus";
      notify("Break's over", "Back to it — one focused task.");
    }

    const secs = durationSeconds(nextPhase, settings);
    setCycle(nextCycle);
    setPhase(nextPhase);
    setRemaining(secs);
    if (settings.autoStart) {
      setEndsAt(Date.now() + secs * 1000);
      setRunning(true);
    } else {
      setRunning(false);
      setEndsAt(null);
    }
  }

  // Keep the interval's expire callback pointed at the latest state.
  useEffect(() => {
    expireRef.current = () => advance(true);
  });

  // Wall-clock countdown: robust to background-tab throttling.
  useEffect(() => {
    if (!running || endsAt == null) return;
    const iv = setInterval(() => {
      const rem = Math.round((endsAt - Date.now()) / 1000);
      if (rem <= 0) {
        clearInterval(iv);
        expireRef.current();
      } else {
        setRemaining(rem);
      }
    }, 250);
    return () => clearInterval(iv);
  }, [running, endsAt]);

  function requestNotify() {
    if (askedNotifyRef.current) return;
    askedNotifyRef.current = true;
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => undefined);
      }
    } catch {
      // ignore
    }
  }

  function start() {
    requestNotify();
    setEndsAt(Date.now() + remaining * 1000);
    setRunning(true);
  }

  function pause() {
    if (endsAt != null) setRemaining(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    setRunning(false);
    setEndsAt(null);
  }

  function reset() {
    setRunning(false);
    setEndsAt(null);
    setPhase("focus");
    setCycle(0);
    setRemaining(durationSeconds("focus", settings));
  }

  function saveSettings(next: Settings) {
    setSettings(next);
    try {
      localStorage.setItem(S_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    if (!running) {
      setRemaining(durationSeconds(phase, next));
      setEndsAt(null);
    }
  }

  const total = durationSeconds(phase, settings);
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;
  const meta = PHASE_META[phase];
  const dotsFilled = cycle % settings.longEvery;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gradient">
          <Timer className="h-6 w-6 text-brand" strokeWidth={2.2} />
          Focus timer
        </h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">
          The Pomodoro technique: {settings.focus} min of focus, then a break — it cycles automatically.
        </p>
        {lecture && (
          <Link
            href={`/pages/${lecture.id}`}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[12.5px] font-medium text-brand hover:underline"
          >
            <Timer className="h-3.5 w-3.5" strokeWidth={2.2} /> Studying: {lecture.title}
          </Link>
        )}
      </div>

      <div className="flex flex-col items-center gap-6 rounded-2xl border border-brand-border grad-brand-soft p-8">
        <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold", meta.pill)}>
          {phase === "focus" ? <Sparkles className="h-3.5 w-3.5" strokeWidth={2.4} /> : <Coffee className="h-3.5 w-3.5" strokeWidth={2.4} />}
          {meta.label}
        </span>

        {/* Progress ring */}
        <div className="relative h-72 w-72">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 300 300">
            <defs>
              <linearGradient id={meta.grad} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={meta.stops[0]} />
                <stop offset="100%" stopColor={meta.stops[1]} />
              </linearGradient>
            </defs>
            <circle cx="150" cy="150" r={RADIUS} fill="none" stroke="#ffffff" strokeWidth="16" />
            <circle
              cx="150"
              cy="150"
              r={RADIUS}
              fill="none"
              stroke={`url(#${meta.grad})`}
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress)}
              className="transition-[stroke-dashoffset] duration-300 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-6xl font-bold tabular-nums tracking-tight text-zinc-900">{fmt(remaining)}</span>
            <span className="mt-1 text-[13px] text-zinc-500">{meta.blurb}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-800"
            aria-label="Reset"
          >
            <RotateCcw className="h-4.5 w-4.5" strokeWidth={2.2} />
          </button>
          <button
            onClick={running ? pause : start}
            className="flex h-16 w-16 items-center justify-center rounded-full grad-brand text-white shadow-brand transition-transform hover:scale-105 active:scale-95"
            aria-label={running ? "Pause" : "Start"}
          >
            {running ? <Pause className="h-7 w-7" strokeWidth={2.4} /> : <Play className="ml-0.5 h-7 w-7" strokeWidth={2.4} />}
          </button>
          <button
            onClick={() => advance(false)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-800"
            aria-label="Skip to next phase"
          >
            <SkipForward className="h-4.5 w-4.5" strokeWidth={2.2} />
          </button>
        </div>

        {/* Cycle dots toward the long break */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: settings.longEvery }).map((_, i) => (
            <span
              key={i}
              className={clsx("h-2 w-2 rounded-full transition-colors", i < dotsFilled ? "grad-brand" : "bg-white/70 ring-1 ring-brand-border")}
            />
          ))}
        </div>
      </div>

      {/* Stats + settings toggle */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-200/80 bg-white p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Sparkles className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <span>
            <span className="block text-lg font-semibold leading-6 text-zinc-900">{completedToday}</span>
            <span className="block text-[12.5px] leading-4 text-zinc-500">Focus sessions today</span>
          </span>
        </div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
        >
          <Settings2 className="h-4 w-4" strokeWidth={2} />
          Settings
        </button>
      </div>

      {showSettings && (
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-zinc-200/80 bg-white p-5 sm:grid-cols-4">
          <DurationField label="Focus" value={settings.focus} onChange={(v) => saveSettings({ ...settings, focus: v })} />
          <DurationField label="Short break" value={settings.short} onChange={(v) => saveSettings({ ...settings, short: v })} />
          <DurationField label="Long break" value={settings.long} onChange={(v) => saveSettings({ ...settings, long: v })} />
          <DurationField label="Long break every" value={settings.longEvery} min={2} max={8} suffix="×" onChange={(v) => saveSettings({ ...settings, longEvery: v })} />
          <label className="col-span-2 flex items-center gap-2 text-[13px] text-zinc-600 sm:col-span-4">
            <input
              type="checkbox"
              checked={settings.autoStart}
              onChange={(e) => saveSettings({ ...settings, autoStart: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-300 accent-brand"
            />
            Automatically start the next focus session and break
          </label>
        </div>
      )}
    </div>
  );
}

function DurationField({
  label,
  value,
  onChange,
  min = 1,
  max = 120,
  suffix = "min",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          className="w-16 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft"
        />
        <span className="text-[12px] text-zinc-400">{suffix}</span>
      </span>
    </label>
  );
}
