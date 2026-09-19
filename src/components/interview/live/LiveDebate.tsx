// src/components/interview/live/LiveDebate.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Swords } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { readPrefs as readReadAloudPrefs } from "@/components/page-detail/ReadAloudBar";
import { useMicHeldByLecture } from "@/components/recording/RecordingProvider";
import {
  BARGE_IN_MS,
  LISTEN_ONSET_MS,
  heardAnswer,
  isEndCommand,
  sensitivityToThreshold,
  type DebateLiveEvent,
} from "@/lib/live-interview";
import { loadKokoro } from "@/lib/speech";
import { ndjsonEvents } from "@/lib/stream-lines";
import { CaptionStrip } from "./CaptionStrip";
import { LiveControls, setLive, useLivePrefs } from "./LiveControls";
import { transcribe, useAct } from "./transcribe";
import { useBrowserRecognition } from "./useBrowserRecognition";
import { useLiveMic, type VadEvent } from "./useLiveMic";
import { useSpeechQueue, type Voice } from "./useSpeechQueue";

/** One voice per side, so the student can tell them apart with eyes closed. */
const DEBATE_VOICES: Record<string, string> = { Proponent: "am_michael", Skeptic: "bf_emma" };
const MODERATOR = "Moderator";
const NOT_HEARD = "Sorry, I didn't catch that. Could you say it again?";
/** The gap between speakers in which the student can cut in before the next one starts. */
const PAUSE_MS = 700;

/**
 * The spoken debate: agents take turns out loud, one request each, and the
 * student cuts in by talking. Their point is graded by the existing interject
 * route, and the next agent corrects or concedes it.
 */
export function LiveDebate({ sessionId, concept }: { sessionId: string; concept: string }) {
  const router = useRouter();
  const [state, act, now] = useAct();
  const [prefs, setPrefs] = useLivePrefs();
  const [rate] = useState(() => readReadAloudPrefs().rate);
  const [student, setStudent] = useState<{ text: string; interim: boolean } | null>(null);
  const [ending, setEnding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const speech = useSpeechQueue();
  const recognition = useBrowserRecognition();
  const lectureMic = useMicHeldByLecture();

  const agentRef = useRef<Promise<unknown> | null>(null);
  // The agent turn being spoken, once the server has saved it. Cleared the moment it can no
  // longer be barged into, so a later cut-in never lands on a turn that already moved on.
  const agentTurnRef = useRef<string | null>(null);
  // Where the student cut in, held until the interrupted turn has an id.
  const pendingCutRef = useRef<number | null>(null);
  // The student's point, kept so "Try again" after a failed interject re-sends it rather than dropping it.
  const pendingInterjectRef = useRef<string | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVadRef = useRef<(event: VadEvent) => void>(() => {});
  // False once the component has ended, switched away, or unmounted, so in-flight async work stops
  // starting new turns instead of talking behind a closed session.
  const alive = useRef(true);
  // The utterance being fetched, so leaving stops the download. The server still saves the turn.
  const agentAbortRef = useRef<AbortController | null>(null);

  const mic = useLiveMic(sensitivityToThreshold(prefs.sensitivity), {
    onsetMs: () => (now() === "listening" ? LISTEN_ONSET_MS : now() === "speaking" ? BARGE_IN_MS : Infinity),
    onVad: (event) => onVadRef.current(event),
  });
  const { arm, take, recording, start: openMic, stop: closeMic, error: micError } = mic;

  const voiceFor = (speaker: string): Voice => ({ voice: DEBATE_VOICES[speaker] ?? "af_heart", rate, lang: "en-US" });

  function clearAdvance() {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  }

  function listen() {
    if (!alive.current) return;
    // A barge-in keeps the recorder and recognizer its rise started, so the first words aren't lost.
    if (recording()) return;
    arm();
    recognition.begin();
  }

  /**
   * While the voice talks, a rise may be the student cutting in: start recording
   * now, and throw it away if it dies before counting as a barge-in. While
   * listening the recorder is already armed, so neither applies.
   */
  function onRiseOrDrop(event: "rise" | "drop") {
    if (now() === "listening") return;
    if (event === "rise") {
      if (now() !== "speaking" || !alive.current) return;
      arm();
      recognition.begin();
    } else if (recording()) {
      recognition.end();
      void take();
    }
  }

  function listenThenAdvance() {
    if (!alive.current) return;
    listen();
    clearAdvance();
    advanceTimer.current = setTimeout(() => {
      if (now() === "listening") void nextAgent();
    }, PAUSE_MS);
  }

  function postInterrupt(turnId: string, interruptedAt: number) {
    void fetch(`/api/interview/${sessionId}/live-turn/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId, interruptedAt }),
    }).catch(() => null);
  }

  function shutDown() {
    alive.current = false;
    agentAbortRef.current?.abort();
    clearAdvance();
    speech.stopAll();
    recognition.end();
    closeMic();
  }

  async function finish() {
    setEnding(true);
    shutDown();
    act({ type: "end" });
    await fetch(`/api/interview/${sessionId}/complete`, { method: "POST" }).catch(() => null);
    router.refresh();
  }

  async function switchToTyping() {
    shutDown();
    act({ type: "end" });
    if (await setLive(sessionId, false)) router.refresh();
    else setSwitchError("Couldn't switch to typing. Try again.");
  }

  async function sendInterject(text: string) {
    pendingInterjectRef.current = text;
    const res = await fetch(`/api/interview/${sessionId}/debate/interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 2000) }),
    }).catch(() => null);
    // A concurrent failure (or the debate ending) already moved the phase on; don't pile on.
    if (now() !== "thinking") return;
    if (!res?.ok) {
      act({ type: "failed", message: "Couldn't hand your point to the debate." });
      return;
    }
    pendingInterjectRef.current = null;
    await nextAgent();
  }

  async function nextAgent() {
    if (!alive.current || now() === "done") return;
    clearAdvance();
    if (now() === "listening" || now() === "idle") {
      recognition.end();
      act({ type: "advance" });
    }
    agentTurnRef.current = null;
    pendingCutRef.current = null;

    const abort = new AbortController();
    agentAbortRef.current = abort;
    const res = await fetch(`/api/interview/${sessionId}/debate/live`, {
      method: "POST",
      signal: abort.signal,
    }).catch(() => null);
    if (!alive.current) return;
    if (!res?.ok || !res.body) {
      const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      act({ type: "failed", message: data.error ?? "The debate could not continue." });
      return;
    }

    const body = res.body;
    const run = (async () => {
      let final = null as DebateLiveEvent | null;
      let started = false;
      try {
        for await (const raw of ndjsonEvents(body)) {
          if (!alive.current) break;
          const event = raw as DebateLiveEvent;
          if (event.type === "speaker") {
            speech.begin(event.speaker, voiceFor(event.speaker));
          } else if (event.type === "text") {
            if (!started) {
              started = true;
              setStudent(null);
              act({ type: "replyStarted" });
            }
            speech.push(event.delta);
          } else {
            final = event;
          }
        }
      } catch {
        // A dropped connection rejects the reader; treat it like a server error event.
        speech.end();
        return null;
      }
      speech.end();
      if (final?.type === "done" && final.turn) {
        agentTurnRef.current = final.turn.id;
        if (pendingCutRef.current !== null) {
          postInterrupt(final.turn.id, pendingCutRef.current);
          pendingCutRef.current = null;
        }
      }
      return final;
    })();
    agentRef.current = run;
    const final = await run;
    if (!alive.current) return;

    if (!final || final.type !== "done") {
      speech.stopAll();
      const wasListening = now() === "listening";
      act({ type: "failed", message: final?.type === "error" ? final.message : "Lost the debate mid-sentence." });
      if (wasListening) {
        // The barge-in already opened a new listening turn; abandon it, we're bailing to the error screen.
        recognition.end();
        void take();
      }
      return;
    }
    if (!final.turn) return void finish();
    if (now() === "thinking") act({ type: "replyStarted" });
    // True while nothing has cut the reply short; a barge-in already moved the phase on.
    const stillSpeaking = () => {
      if (now() === "speaking") return true;
      if (final.finished) void finish();
      return false;
    };
    if (!stillSpeaking()) return;
    await speech.whenIdle();
    if (!alive.current) return;
    if (!stillSpeaking()) return;
    act({ type: "replyDone", completed: final.finished });
    agentTurnRef.current = null;
    if (final.finished) void finish();
    else listenThenAdvance();
  }

  async function onSpeechEnd() {
    if (!alive.current || now() !== "listening") return;
    clearAdvance();
    act({ type: "speechEnd" });
    const preview = recognition.text;
    if (preview) setStudent({ text: preview, interim: true });
    recognition.end();
    const blob = await take();
    if (now() !== "transcribing") return;
    await agentRef.current;
    if (now() !== "transcribing") return;
    const local = await transcribe(sessionId, blob, null);
    if (now() !== "transcribing") return;
    const answer = heardAnswer(local, preview);

    if (!answer) {
      act({ type: "empty" });
      // Never post a stray barge-in offset onto the previous agent's turn while the moderator talks.
      agentTurnRef.current = null;
      if (!alive.current) return; // torn down while transcribing
      await speech.speakAll(MODERATOR, voiceFor(MODERATOR), NOT_HEARD);
      if (now() !== "speaking") return;
      act({ type: "replyDone", completed: false });
      listenThenAdvance();
      return;
    }
    setStudent({ text: answer.text, interim: false });
    if (isEndCommand(answer.text)) return void finish();
    act({ type: "transcribed" });
    await sendInterject(answer.text);
  }

  function onSpeechStart() {
    // Speaking in the pause between agents holds the next one back.
    clearAdvance();
    if (now() !== "speaking") return;
    const heard = speech.interrupt();
    const turnId = agentTurnRef.current;
    if (turnId) {
      postInterrupt(turnId, heard);
      // Posted once; a further barge-in before the next turn has an id has nothing to attach to.
      agentTurnRef.current = null;
    } else {
      pendingCutRef.current = heard;
    }
    act({ type: "bargeIn" });
    listen();
  }

  useEffect(() => {
    onVadRef.current = (event) => {
      if (event === "start") onSpeechStart();
      else if (event === "end") void onSpeechEnd();
      else onRiseOrDrop(event);
    };
  });

  // Stops audio and the mic on unmount, not just on End/Switch-to-typing.
  // Re-arms `alive` on mount: StrictMode unmounts and remounts once in dev.
  useEffect(() => {
    alive.current = true;
    return () => shutDown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function begin() {
    if (starting) return;
    setStarting(true);
    loadKokoro();
    if (!(await openMic())) {
      setStarting(false);
      return;
    }
    await nextAgent();
  }

  const shownStudent =
    state.phase === "listening"
      ? recognition.text
        ? { text: recognition.text, interim: true }
        : null
      : state.phase === "transcribing" || state.phase === "thinking"
        ? student
        : null;

  return (
    <section className="flex flex-col gap-4" aria-label="Live debate">
      {state.phase === "idle" ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-lavender-soft bg-lavender-soft/30 p-5">
          <p className="text-sm text-ink">
            Two debaters argue &ldquo;{concept}&rdquo; out loud. Cut in any time to make your point, and they&apos;ll
            answer it. If you&apos;re wrong, expect to be corrected with an example.
          </p>
          {lectureMic && (
            <p className="text-[13px] font-medium text-red-700">
              Your lecture recording is using the microphone. Stop it to talk live.
            </p>
          )}
          {micError && <p className="text-[13px] font-medium text-red-700">{micError}</p>}
          <Button variant="brand" onClick={() => void begin()} disabled={!!lectureMic || starting}>
            <Swords className="h-4 w-4" strokeWidth={2} />
            Start the debate
          </Button>
        </div>
      ) : (
        <CaptionStrip
          caption={speech.caption}
          student={shownStudent}
          lastSpoken={speech.lastSpoken}
          visible={prefs.captions}
        />
      )}

      {state.phase === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[13px] font-medium text-red-700">{state.error ?? "The debate stopped."}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              act({ type: "retry" });
              if (pendingInterjectRef.current) void sendInterject(pendingInterjectRef.current);
              else void nextAgent();
            }}
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Try again
          </Button>
        </div>
      )}

      {switchError && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          {switchError}
        </p>
      )}

      <LiveControls
        phase={state.phase}
        prefs={prefs}
        onPrefs={setPrefs}
        onEnd={() => void finish()}
        onSwitchToTyping={() => void switchToTyping()}
        ending={ending}
      />
    </section>
  );
}
