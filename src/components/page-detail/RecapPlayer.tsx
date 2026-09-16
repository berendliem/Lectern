"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, Loader2, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { splitForSpeech } from "@/lib/recap-speech";
import {
  DEFAULT_VOICE,
  loadKokoro,
  pauseSpeech,
  resumeSpeech,
  say,
  silence,
  speechSupported,
} from "@/lib/speech";

type Phase = "idle" | "writing" | "speaking" | "paused" | "done";

/**
 * A ninety-second spoken recap of the lecture, read by the on-device voice in
 * speech.ts — no audio file to generate on a server, download, or store.
 *
 * ponytail: one voice, not the two-host podcast the study apps advertise, and
 * always the default voice rather than the one picked in the read-aloud bar.
 * Share that preference if students ask for it.
 */
export function RecapPlayer({ pageId }: { pageId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [script, setScript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every play, stop and unmount, so a chunk that settles after the
  // student moved on cannot carry the old reading forward.
  const runRef = useRef(0);

  // Speech is a global the component does not own: leaving the page mid-recap
  // must stop the voice, not let it follow the student around the app.
  useEffect(
    () => () => {
      runRef.current++;
      silence();
    },
    []
  );

  async function speak(text: string) {
    const run = ++runRef.current;
    silence();

    const chunks = splitForSpeech(text);
    if (chunks.length === 0) {
      // Returning quietly here would leave the button spinning on "Writing the
      // recap…" with nothing to wait for.
      setError("The recap came back empty. Try again.");
      setPhase("idle");
      return;
    }

    setPhase("speaking");
    for (let i = 0; i < chunks.length; i++) {
      const outcome = await say(chunks[i], { voice: DEFAULT_VOICE, rate: 1, lang: "en", next: chunks[i + 1] });
      if (run !== runRef.current) return;
      if (outcome === "cancelled") {
        // Silenced from elsewhere — the read-aloud bar started over the recap.
        setPhase("idle");
        return;
      }
      if (outcome === "failed") {
        setError("The voice stopped reading the recap.");
        break;
      }
    }
    setPhase("done");
  }

  async function generateAndPlay() {
    if (!speechSupported()) {
      setError("This browser cannot read text aloud.");
      return;
    }
    // Started on the click, so the voice downloads while the recap is written.
    loadKokoro();
    if (script) {
      void speak(script);
      return;
    }
    setPhase("writing");
    setError(null);
    // Writing takes seconds. Leaving the page in that window bumps the token,
    // and a recap that arrives after has no player left to stop it.
    const run = runRef.current;
    try {
      const res = await fetch(`/api/pages/${pageId}/recap`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Could not write the recap. Try again.");
        setPhase("idle");
        return;
      }
      const body = (await res.json()) as { script?: unknown };
      // Checked rather than asserted: a cast would hand `undefined` to the
      // splitter and report a network problem for what is a malformed reply.
      if (typeof body.script !== "string" || body.script.trim() === "") {
        setError("The recap came back empty. Try again.");
        setPhase("idle");
        return;
      }
      if (run !== runRef.current) return;
      setScript(body.script);
      void speak(body.script);
    } catch {
      // A rejected fetch or an unreadable body must not leave the button
      // spinning with no way back.
      setError("Could not reach Lectern. Check it is still running, then try again.");
      setPhase("idle");
    }
  }

  function pause() {
    pauseSpeech();
    setPhase("paused");
  }

  function resume() {
    resumeSpeech();
    setPhase("speaking");
  }

  function stop() {
    runRef.current++;
    silence();
    setPhase("idle");
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Headphones className="h-4 w-4 text-muted-2" strokeWidth={2} />
        <p className="text-sm font-medium text-ink">Listen to a recap</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {phase === "speaking" ? (
          <>
            <Button variant="secondary" size="sm" onClick={pause}>
              <Pause className="h-4 w-4" strokeWidth={2} />
              Pause
            </Button>
            <Button variant="ghost" size="sm" onClick={stop}>
              <Square className="h-4 w-4" strokeWidth={2} />
              Stop
            </Button>
          </>
        ) : phase === "paused" ? (
          <>
            <Button variant="secondary" size="sm" onClick={resume}>
              <Play className="h-4 w-4" strokeWidth={2} />
              Resume
            </Button>
            <Button variant="ghost" size="sm" onClick={stop}>
              <Square className="h-4 w-4" strokeWidth={2} />
              Stop
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={generateAndPlay} disabled={phase === "writing"}>
            {phase === "writing" ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Play className="h-4 w-4" strokeWidth={2} />
            )}
            {phase === "writing" ? "Writing the recap…" : phase === "done" ? "Play again" : "Play recap"}
          </Button>
        )}
      </div>

      <p className="text-[13px] text-muted-2">
        About ninety seconds, read by a voice that runs on your computer. Written fresh each session — it is not saved.
      </p>
      {/*
        The recap plays with no visual change beyond the button, so a listener
        using a screen reader needs the phase spoken as it happens.
      */}
      <p aria-live="polite" className="sr-only">
        {phase === "writing"
          ? "Writing the recap"
          : phase === "speaking"
            ? "Playing the recap"
            : phase === "paused"
              ? "Recap paused"
              : phase === "done"
                ? "Recap finished"
                : ""}
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
