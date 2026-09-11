"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMediaRecorder, type RecorderStatus } from "@/components/recording/useMediaRecorder";
import { transcribePage, uploadAudio } from "@/components/recording/upload";
import { useTasks } from "@/components/tasks/TaskProvider";
import { formatElapsed } from "@/lib/format";

export type RecordingSession = { pageId: string; pageTitle: string };

type RecordingContextValue = {
  session: RecordingSession | null;
  status: RecorderStatus;
  elapsedSeconds: number;
  level: number;
  audioBlob: Blob | null;
  error: string | null;
  liveTranscript: string;
  liveBusy: boolean;
  saving: boolean;
  saveError: string | null;
  start(page: { id: string; title: string }): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  discard(): void;
  save(): Promise<void>;
};

const RecordingContext = createContext<RecordingContextValue | null>(null);

/**
 * One recording, app-wide, owned above the router. Before this, the recorder
 * lived in the Transcript tab: clicking another tab mid-lecture unmounted the
 * component that held the blob, and the lecture was gone.
 */
export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { run } = useTasks();
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveBusy, setLiveBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // `save()` resumes after two network round-trips, by which time a `start()`
  // may have replaced the session under it. Written after commit, never during
  // render, this lets the tail ask "am I still the current session?" — it is
  // never the source of the pageId or the blob, which stay on one snapshot.
  const currentSessionRef = useRef<RecordingSession | null>(null);
  useEffect(() => {
    currentSessionRef.current = session;
  }, [session]);

  // A reload or a tab close takes the take with it: the recorder's chunks and
  // the assembled blob live in this tab and nowhere else, and nothing has
  // reached the server until `save()` finishes. Registered only while a session
  // exists, so browsing the rest of the app is never interrupted.
  useEffect(() => {
    if (!session) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers cancel on a non-empty returnValue rather than on
      // preventDefault(); the text itself is not shown any more.
      e.returnValue = "A lecture recording is still unsaved.";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [session]);

  const handleLiveSegment = useCallback(async (blob: Blob) => {
    setLiveBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, "segment.webm");
      const res = await fetch("/api/live-transcribe", { method: "POST", body: formData });
      if (res.ok) {
        const { text } = await res.json();
        if (text?.trim()) setLiveTranscript((t) => (t ? `${t} ${text.trim()}` : text.trim()));
      }
    } catch {
      // The live transcript is a preview of a segment already on disk in the
      // recorder's chunks. A dropped segment costs nothing: the saved audio is
      // transcribed in full at save time. The recorder fires this without
      // awaiting it, so a throw here would surface as an unhandled rejection.
    } finally {
      setLiveBusy(false);
    }
  }, []);

  const recorder = useMediaRecorder({ onLiveSegment: handleLiveSegment });

  const start = useCallback(
    async (page: { id: string; title: string }) => {
      // One recording at a time, app-wide. A second `startRecording()` would
      // overwrite the recorder's refs mid-take: the first recorder keeps running
      // with nobody holding its output, its chunks bleed into the new take's
      // array, and its stream's tracks leak with the microphone still open. A
      // stopped-but-unsaved take counts as live — its blob is the only copy.
      const unsavedTake = recorder.status === "stopped" && recorder.audioBlob !== null;
      if (session || recorder.status === "recording" || recorder.status === "paused" || unsavedTake) {
        // Refuse silently and leave the existing session's state alone: both the
        // panel and the shell bar already show the recording that is in the way.
        return;
      }
      setSaveError(null);
      setLiveTranscript("");
      const started = await recorder.startRecording();
      if (started) setSession({ pageId: page.id, pageTitle: page.title });
    },
    [recorder, session]
  );

  const discard = useCallback(() => {
    recorder.discard();
    setSession(null);
    setLiveTranscript("");
    setSaveError(null);
    // A save whose upload never comes back leaves `saving` set for good, and
    // every other control is gated on it. Discard is the escape hatch, so it
    // owns clearing the flag: the take is gone either way.
    setSaving(false);
  }, [recorder]);

  const save = useCallback(async () => {
    // A second invoke while the first is still in flight would upload the same
    // take twice.
    if (saving) return;
    // The session and the blob are read from the same render, so a caller
    // holding an older `save` can only be a no-op — never this lecture's audio
    // filed against the page a later session moved on to.
    const startedSession = session;
    const blob = recorder.audioBlob;
    if (!startedSession || !blob) return;
    const { pageId } = startedSession;
    setSaving(true);
    setSaveError(null);

    // Discard stays live during a save, and a `start()` can land here too. Once
    // this take is no longer the one on screen, nothing from this call belongs
    // there — not an error about audio the user threw away, and not a `reset()`
    // that would blank a recording already in progress.
    const stillMine = () => currentSessionRef.current === startedSession;

    const uploaded = await uploadAudio(pageId, blob, "recording.webm", recorder.elapsedSeconds);
    if (!uploaded.ok) {
      // The blob stays in the provider so the panel can still offer it as a
      // download — this is the user's only copy of the lecture.
      setSaving(false);
      if (stillMine()) setSaveError(uploaded.error);
      return;
    }
    router.refresh();

    const outcome = await run(
      { key: `page:${pageId}:transcribe`, label: "Transcribing the recording…", href: `/pages/${pageId}` },
      async () => {
        const transcribed = await transcribePage(pageId);
        if (!transcribed.ok) throw new Error(transcribed.error);
      }
    );

    setSaving(false);
    // `ran: false` means a transcribe for this lecture was already in flight, so
    // this take's audio — which only reached the server a moment ago — was never
    // handed to it. Reporting that other run's "done" as ours would drop the
    // blob and leave the lecture with audio and no transcript, silently.
    const failure = !outcome.ran
      ? "Uploaded, but not transcribed: a transcription was already running for this lecture. Transcribe it again from the banner on the lecture page."
      : outcome.status === "error"
        ? (outcome.error ?? "Transcription failed. You can retry it.")
        : null;
    if (failure) {
      // The audio is on the server, but hold the session and the blob anyway:
      // the user gets the message, the download, and a session to retry from.
      if (stillMine()) setSaveError(failure);
      return;
    }

    router.refresh();

    if (!stillMine()) return;
    recorder.reset();
    setSession((prev) => (prev === startedSession ? null : prev));
    setLiveTranscript("");
  }, [recorder, router, run, saving, session]);

  const value = useMemo<RecordingContextValue>(
    () => ({
      session,
      status: recorder.status,
      elapsedSeconds: recorder.elapsedSeconds,
      level: recorder.level,
      audioBlob: recorder.audioBlob,
      error: recorder.error,
      liveTranscript,
      liveBusy,
      saving,
      saveError,
      start,
      pause: recorder.pauseRecording,
      resume: recorder.resumeRecording,
      stop: recorder.stopRecording,
      discard,
      save,
    }),
    [session, recorder, liveTranscript, liveBusy, saving, saveError, start, discard, save]
  );

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>;
}

/**
 * The session currently holding the microphone, or null when it is free.
 *
 * A second `getUserMedia()` does not queue: on Safari it revokes the first
 * capture and the lecture goes silent with nothing on screen to say so. The
 * lecture recorder now follows the user around the app, so every other mic
 * entry point — dictation, the copilot, spoken interview answers — has to stand
 * down while a take is live. Returns the session so the caller can link to it.
 */
export function useMicHeldByLecture(): RecordingSession | null {
  const { session, status } = useRecording();
  // A stopped-but-unsaved take has already released its tracks; it is the only
  // session state that does not hold the device.
  return session && (status === "recording" || status === "paused") ? session : null;
}

/**
 * Names what a discard destroys before it happens, per AGENTS.md: the take is
 * the only copy of that stretch of the lecture, and no undo brings it back.
 * Shared by the shell bar and the panel so the two cannot drift apart.
 */
export function confirmDiscard(session: RecordingSession, elapsedSeconds: number): boolean {
  return window.confirm(
    `Discard the recording for "${session.pageTitle}"? Its ${formatElapsed(elapsedSeconds)} of audio has not been saved anywhere — this permanently deletes the only copy.`
  );
}

export function useRecording(): RecordingContextValue {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error("useRecording must be used inside <RecordingProvider>");
  return ctx;
}
