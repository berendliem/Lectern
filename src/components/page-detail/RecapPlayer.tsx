"use client";

import { useEffect, useRef, useState } from "react";
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

  // Speech is a global the component does not own: leaving the page mid-recap
  // must stop the voice, not let it follow the student around the app.
  useEffect(() => {
    return () => {
      if (hasSpeech()) window.speechSynthesis.cancel();
    };
  }, []);

  function speak(text: string) {
    const synth = window.speechSynthesis;
    synth.cancel();

    const chunks = splitForSpeech(text);
    if (chunks.length === 0) return;

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
    const res = await fetch(`/api/pages/${pageId}/recap`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not write the recap. Try again.");
      setPhase("idle");
      return;
    }
    const { script: text } = (await res.json()) as { script: string };
    setScript(text);
    speak(text);
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
    window.speechSynthesis.cancel();
    queued.current = [];
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
      {error && <p className="text-[13px] text-red-600">{error}</p>}
    </div>
  );
}
