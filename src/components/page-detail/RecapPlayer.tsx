"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Loader2, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { splitForSpeech } from "@/lib/recap-speech";

type Phase = "idle" | "writing" | "speaking" | "paused" | "done";

/**
 * Checked at the click rather than at render: the server has no
 * `speechSynthesis`, so deciding at render whether to show the control at all
 * would have the server and the browser disagree about the markup.
 */
const hasSpeech = () => typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * A ninety-second spoken recap of the lecture, read by the browser's own
 * speech synthesizer — no audio file to generate, download, or store.
 *
 * ponytail: one synthesizer voice, not the two-host podcast the study apps
 * advertise. That needs a paid TTS API and audio stitching; this needs nothing
 * and works offline. Revisit if a voice is ever worth paying for.
 */
export function RecapPlayer({ pageId }: { pageId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [script, setScript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Utterances must outlive the render that created them: some browsers
  // garbage-collect an utterance mid-sentence if nothing else holds it.
  const queued = useRef<SpeechSynthesisUtterance[]>([]);

  /**
   * Cancelling speech fires `error` on whatever was mid-sentence — the spec
   * calls it `canceled`, and it arrives by the same path a genuine failure
   * would. Letting those handlers survive a deliberate Stop means the student
   * is told the browser gave up on a recap they themselves ended, so the
   * handlers come off before the queue is thrown away.
   */
  const silenceQueue = useCallback(() => {
    if (!hasSpeech()) return;
    for (const u of queued.current) {
      u.onend = null;
      u.onerror = null;
    }
    queued.current = [];
    window.speechSynthesis.cancel();
  }, []);

  // Speech is a global the component does not own: leaving the page mid-recap
  // must stop the voice, not let it follow the student around the app.
  useEffect(() => silenceQueue, [silenceQueue]);

  function speak(text: string) {
    const synth = window.speechSynthesis;
    silenceQueue();

    const chunks = splitForSpeech(text);
    if (chunks.length === 0) {
      // Returning quietly here would leave the button spinning on "Writing the
      // recap…" with nothing to wait for.
      setError("The recap came back empty. Try again.");
      setPhase("idle");
      return;
    }

    queued.current = chunks.map((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      if (i === chunks.length - 1) utterance.onend = () => setPhase("done");
      utterance.onerror = () => {
        setError("The browser stopped reading the recap.");
        setPhase("done");
      };
      return utterance;
    });

    queued.current.forEach((u) => synth.speak(u));
    setPhase("speaking");
  }

  async function generateAndPlay() {
    if (!hasSpeech()) {
      setError("This browser cannot read text aloud.");
      return;
    }
    if (script) {
      speak(script);
      return;
    }
    setPhase("writing");
    setError(null);
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
      setScript(body.script);
      speak(body.script);
    } catch {
      // A rejected fetch or an unreadable body must not leave the button
      // spinning with no way back.
      setError("Could not reach Lectern. Check it is still running, then try again.");
      setPhase("idle");
    }
  }

  function pause() {
    window.speechSynthesis.pause();
    setPhase("paused");
  }

  function resume() {
    window.speechSynthesis.resume();
    setPhase("speaking");
  }

  function stop() {
    silenceQueue();
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
        About ninety seconds, read by your browser&apos;s voice. Written fresh each session — it is not saved.
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
