"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMediaRecorder, type RecorderStatus } from "@/components/recording/useMediaRecorder";
import { transcribePage, uploadAudio } from "@/components/recording/upload";
import { useTasks } from "@/components/tasks/TaskProvider";

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
      setSession({ pageId: page.id, pageTitle: page.title });
      await recorder.startRecording();
    },
    [recorder, session]
  );

  const discard = useCallback(() => {
    recorder.discard();
    setSession(null);
    setLiveTranscript("");
    setSaveError(null);
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

    const uploaded = await uploadAudio(pageId, blob, "recording.webm", recorder.elapsedSeconds);
    if (!uploaded.ok) {
      // The blob stays in the provider so the panel can still offer it as a
      // download — this is the user's only copy of the lecture.
      setSaving(false);
      setSaveError(uploaded.error);
      return;
    }
    router.refresh();

    // `run` never rethrows, so the outcome has to come back on a local: reading
    // it from `task(key)` afterwards would read this render's stale snapshot.
    let transcribeError: string | null = null;
    await run(
      { key: `page:${pageId}:transcribe`, label: "Transcribing the recording…", href: `/pages/${pageId}` },
      async () => {
        const transcribed = await transcribePage(pageId);
        if (!transcribed.ok) {
          transcribeError = transcribed.error;
          throw new Error(transcribed.error);
        }
      }
    );

    setSaving(false);
    if (transcribeError) {
      // The audio is on the server, but hold the session and the blob anyway:
      // the user gets the error, the download, and a session to retry from.
      setSaveError(transcribeError);
      return;
    }

    router.refresh();

    // Release the take only if it is still the one on screen. A `start()` during
    // the awaits above would have moved the session on, and `reset()` then blanks
    // the blob and the status of a recording still in progress.
    if (currentSessionRef.current !== startedSession) return;
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

export function useRecording(): RecordingContextValue {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error("useRecording must be used inside <RecordingProvider>");
  return ctx;
}
