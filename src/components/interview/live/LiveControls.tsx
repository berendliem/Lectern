// src/components/interview/live/LiveControls.tsx
"use client";

import { useState } from "react";
import { Captions, CaptionsOff, Keyboard, Loader2, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DEFAULT_SENSITIVITY, type LivePhase } from "@/lib/live-interview";

export type LivePrefs = { captions: boolean; sensitivity: number };

const PREFS_KEY = "lectern.live";
const DEFAULTS: LivePrefs = { captions: true, sensitivity: DEFAULT_SENSITIVITY };

function readPrefs(): LivePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Record<keyof LivePrefs, unknown>>;
      return {
        captions: typeof saved.captions === "boolean" ? saved.captions : DEFAULTS.captions,
        sensitivity:
          typeof saved.sensitivity === "number" ? Math.min(1, Math.max(0, saved.sensitivity)) : DEFAULTS.sensitivity,
      };
    }
  } catch {
    // No storage (server render, private mode) or a corrupt value: use defaults.
  }
  return DEFAULTS;
}

export function useLivePrefs(): [LivePrefs, (next: LivePrefs) => void] {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = (next: LivePrefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Unsaved is fine: the setting still applies for this session.
    }
  };
  return [prefs, update];
}

const PHASE_LABEL: Record<LivePhase, string> = {
  idle: "Ready",
  listening: "Listening…",
  transcribing: "Catching that…",
  thinking: "Thinking…",
  speaking: "Speaking — talk over me to cut in",
  error: "Stopped",
  done: "Finished",
};

export async function setLive(sessionId: string, live: boolean): Promise<boolean> {
  const res = await fetch(`/api/interview/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ live }),
  }).catch(() => null);
  return !!res?.ok;
}

export function LiveControls({
  phase,
  prefs,
  onPrefs,
  onEnd,
  onSwitchToTyping,
  ending,
}: {
  phase: LivePhase;
  prefs: LivePrefs;
  onPrefs: (next: LivePrefs) => void;
  onEnd: () => void;
  onSwitchToTyping: () => void;
  ending: boolean;
}) {
  const listening = phase === "listening";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-2 text-[13px] font-medium text-muted" role="status">
        <span
          aria-hidden
          className={listening ? "h-2.5 w-2.5 rounded-full bg-brand" : "h-2.5 w-2.5 rounded-full bg-line-strong"}
        />
        {PHASE_LABEL[phase]}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Mic sensitivity
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.sensitivity}
            onChange={(e) => onPrefs({ ...prefs, sensitivity: Number(e.target.value) })}
            className="w-24 accent-brand"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={prefs.captions}
          onClick={() => onPrefs({ ...prefs, captions: !prefs.captions })}
        >
          {prefs.captions ? <Captions className="h-4 w-4" strokeWidth={2} /> : <CaptionsOff className="h-4 w-4" strokeWidth={2} />}
          CC
        </Button>
        <Button variant="ghost" size="sm" onClick={onSwitchToTyping}>
          <Keyboard className="h-4 w-4" strokeWidth={2} />
          Switch to typing
        </Button>
        <Button variant="danger" size="sm" onClick={onEnd} disabled={ending}>
          {ending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <PhoneOff className="h-4 w-4" strokeWidth={2} />}
          End
        </Button>
      </div>
    </div>
  );
}
