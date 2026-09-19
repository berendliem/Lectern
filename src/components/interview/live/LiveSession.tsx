// src/components/interview/live/LiveSession.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { readPrefs as readReadAloudPrefs } from "@/components/page-detail/ReadAloudBar";
import { useMicHeldByLecture } from "@/components/recording/RecordingProvider";
import {
  BARGE_IN_MS,
  LISTEN_ONSET_MS,
  heardAnswer,
  isEndCommand,
  sensitivityToThreshold,
  type LiveNextTurn,
  type LiveTurnEvent,
  type TranscriptSource,
} from "@/lib/live-interview";
import { tutorName } from "@/lib/live-transcript";
import { loadKokoro } from "@/lib/speech";
import { ndjsonEvents } from "@/lib/stream-lines";
import { CaptionStrip } from "./CaptionStrip";
import { LiveControls, setLive, useLivePrefs } from "./LiveControls";
import { transcribe, useAct } from "./transcribe";
import { useBrowserRecognition } from "./useBrowserRecognition";
import { useLiveMic } from "./useLiveMic";
import { useSpeechQueue, type Voice } from "./useSpeechQueue";

const NOT_HEARD = "Sorry, I didn't catch that. Could you say it again?";

function tutorVoice(): Voice {
  const prefs = readReadAloudPrefs();
  return { voice: prefs.voiceId, rate: prefs.rate, lang: "en-US" };
}

type Answer = { text: string; source: TranscriptSource };

/**
 * The spoken viva or protégé: the tutor speaks, the mic listens, silence ends
 * the student's turn, and talking over the tutor cuts it off.
 */
export function LiveSession({
  sessionId,
  mode,
  openTurn,
}: {
  sessionId: string;
  mode: "VIVA" | "PROTEGE";
  openTurn: LiveNextTurn | null;
}) {
  const router = useRouter();
  const [state, act, now] = useAct();
  const [prefs, setPrefs] = useLivePrefs();
  const [voice] = useState(tutorVoice);
  const [student, setStudent] = useState<{ text: string; interim: boolean } | null>(null);
  const [ending, setEnding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const speech = useSpeechQueue();
  const recognition = useBrowserRecognition();
  const lectureMic = useMicHeldByLecture();
  const tutor = tutorName(mode);

  const turnRef = useRef<LiveNextTurn | null>(openTurn);
  // The turn whose reply is being spoken, for recording where a barge-in landed.
  const replyTurnRef = useRef<string | null>(null);
  // A reply still streaming after a barge-in; the next answer waits for it to be saved.
  const replyRef = useRef<Promise<unknown> | null>(null);
  const lastAnswerRef = useRef<Answer | null>(null);
  const onVadRef = useRef<(event: "start" | "end") => void>(() => {});
  // False once torn down, so a reply still streaming in from a dead session is ignored rather than acted on.
  const aliveRef = useRef(true);

  const mic = useLiveMic(sensitivityToThreshold(prefs.sensitivity), {
    onsetMs: () => (now() === "listening" ? LISTEN_ONSET_MS : now() === "speaking" ? BARGE_IN_MS : Infinity),
    onVad: (event) => onVadRef.current(event),
  });
  const { arm, take, start: openMic, stop: closeMic, error: micError } = mic;

  function listen() {
    if (!aliveRef.current) return; // torn down: nothing should open the mic or a recognizer
    arm();
    recognition.begin();
  }

  function shutDown() {
    aliveRef.current = false;
    speech.stopAll();
    recognition.end();
    closeMic();
  }

  // Stops audio and the mic on unmount, not just on End/Switch-to-typing.
  // Re-arms `alive` on mount: StrictMode unmounts and remounts once in dev.
  useEffect(() => {
    aliveRef.current = true;
    return () => shutDown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish() {
    setEnding(true);
    shutDown();
    act({ type: "end" });
    await fetch(`/api/interview/${sessionId}/complete`, { method: "POST" }).catch(() => null);
    router.refresh();
  }

  async function switchToTyping() {
    shutDown();
    act({ type: "end" }); // nothing should resume listening once we're leaving live mode
    setSwitchError(null);
    if (await setLive(sessionId, false)) router.refresh();
    else setSwitchError("Couldn't switch back to typing. Try again.");
  }

  async function sendAnswer(answer: Answer) {
    const turn = turnRef.current;
    if (!turn) return finish();
    lastAnswerRef.current = answer;

    const res = await fetch(`/api/interview/${sessionId}/live-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId: turn.id, answer: answer.text, transcriptSource: answer.source }),
    }).catch(() => null);
    if (now() !== "thinking") {
      void res?.body?.cancel().catch(() => {}); // ended or switched to typing while this was in flight
      return;
    }
    if (!res?.ok || !res.body) {
      const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      act({ type: "failed", message: data.error ?? "Couldn't reach the tutor." });
      return;
    }

    replyTurnRef.current = turn.id;
    if (!aliveRef.current) return; // torn down while the fetch was in flight
    speech.begin(tutor, voice);
    const body = res.body;
    const reply = (async () => {
      let final = null as LiveTurnEvent | null;
      let started = false;
      try {
        for await (const raw of ndjsonEvents(body)) {
          if (!aliveRef.current) break; // torn down mid-stream: stop feeding a dead session
          const event = raw as LiveTurnEvent;
          if (event.type === "text") {
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
        // A dropped connection mid-stream: report it like any other lost reply
        // instead of leaving an unhandled rejection and a stuck phase.
        speech.end();
        return null;
      }
      speech.end();
      if (final?.type === "done") turnRef.current = final.nextTurn;
      return final;
    })();
    replyRef.current = reply;
    const final = await reply;

    if (!final || final.type !== "done") {
      speech.stopAll();
      const wasListening = now() === "listening";
      act({ type: "failed", message: final?.type === "error" ? final.message : "Lost the tutor mid-reply." });
      if (wasListening) {
        // The barge-in already opened a new listening turn; abandon it, we're bailing to the error screen.
        recognition.end();
        void take();
      }
      return;
    }
    if (now() === "thinking") act({ type: "replyStarted" });
    // Cut in: the student's words are already the answer to the next turn.
    if (now() !== "speaking") {
      // Barged into what turned out to be the last reply: there's nothing left to answer.
      if (final.completed && now() === "listening") void finish();
      return;
    }
    await speech.whenIdle();
    if (now() !== "speaking") {
      if (final.completed && now() === "listening") void finish();
      return;
    }
    replyTurnRef.current = null;
    act({ type: "replyDone", completed: final.completed });
    if (final.completed) void finish();
    else listen();
  }

  async function onSpeechEnd() {
    if (now() !== "listening") return;
    act({ type: "speechEnd" });
    const preview = recognition.text;
    if (preview) setStudent({ text: preview, interim: true });
    recognition.end();
    const blob = await take();
    await replyRef.current;
    if (now() !== "transcribing") return; // a stale reply just failed or ended the session
    const turn = turnRef.current;
    const answer = heardAnswer(await transcribe(sessionId, blob, turn?.id ?? null), preview);

    if (!answer) {
      act({ type: "empty" });
      replyTurnRef.current = null; // "I didn't catch that" isn't a reply to whatever a barge-in interrupted
      await speech.speakAll(tutor, voice, NOT_HEARD);
      if (now() !== "speaking") return;
      act({ type: "replyDone", completed: false });
      listen();
      return;
    }
    setStudent({ text: answer.text, interim: false });
    if (isEndCommand(answer.text) || !turn) return void finish();
    act({ type: "transcribed" });
    await sendAnswer(answer);
  }

  function onSpeechStart() {
    if (now() !== "speaking") return;
    const heard = speech.interrupt();
    const turnId = replyTurnRef.current;
    replyTurnRef.current = null;
    if (turnId) {
      void fetch(`/api/interview/${sessionId}/live-turn/interrupt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId, interruptedAt: heard }),
      }).catch(() => null);
    }
    act({ type: "bargeIn" });
    listen();
  }

  useEffect(() => {
    onVadRef.current = (event) => {
      if (event === "start") onSpeechStart();
      else void onSpeechEnd();
    };
  });

  async function begin() {
    if (!openTurn) return void finish();
    if (starting) return; // a double-click would otherwise open the mic twice and leak a stream
    setStarting(true);
    // Both need the click: Kokoro's AudioContext and the mic prompt.
    loadKokoro();
    if (!(await openMic())) {
      setStarting(false);
      return;
    }
    act({ type: "start" });
    await speech.speakAll(tutor, voice, openTurn.question);
    if (now() !== "speaking") return;
    act({ type: "replyDone", completed: false });
    listen();
  }

  async function retry() {
    const answer = lastAnswerRef.current;
    act({ type: "retry" });
    if (answer) await sendAnswer(answer);
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
    <section className="flex flex-col gap-4" aria-label="Live interview">
      {state.phase === "idle" ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-brand-border bg-brand-soft/40 p-5">
          <p className="text-sm text-ink">
            Talk it through out loud. When you&apos;re done answering, pause for a moment. Talk over the{" "}
            {tutor.toLowerCase()} to cut in. Headphones help in a noisy room.
          </p>
          {lectureMic && (
            <p className="text-[13px] font-medium text-red-700">
              Your lecture recording is using the microphone. Stop it to talk live.
            </p>
          )}
          {micError && <p className="text-[13px] font-medium text-red-700">{micError}</p>}
          <Button variant="brand" onClick={() => void begin()} disabled={!!lectureMic || starting}>
            <Mic className="h-4 w-4" strokeWidth={2} />
            Start talking
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
          <p className="text-[13px] font-medium text-red-700">{state.error ?? "Lost the tutor."}</p>
          <Button variant="secondary" size="sm" onClick={() => void retry()}>
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Try again
          </Button>
        </div>
      )}

      <LiveControls
        phase={state.phase}
        prefs={prefs}
        onPrefs={setPrefs}
        onEnd={() => void finish()}
        onSwitchToTyping={() => void switchToTyping()}
        ending={ending}
      />
      {switchError && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          {switchError}
        </p>
      )}
      {!recognition.supported && state.phase !== "idle" && (
        <p className="text-[12.5px] text-muted">
          This browser can&apos;t preview speech, so your words appear once they&apos;re transcribed.
        </p>
      )}
    </section>
  );
}
