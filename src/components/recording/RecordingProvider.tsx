"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
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
      setSaveError(null);
      setLiveTranscript("");
      setSession({ pageId: page.id, pageTitle: page.title });
      await recorder.startRecording();
    },
    [recorder]
  );

  const discard = useCallback(() => {
    recorder.discard();
    setSession(null);
    setLiveTranscript("");
    setSaveError(null);
  }, [recorder]);

  const save = useCallback(async () => {
    // The session and the blob are read from the same render, so a caller
    // holding an older `save` can only be a no-op — never this lecture's audio
    // filed against the page a later session moved on to.
    const blob = recorder.audioBlob;
    if (!session || !blob) return;
    const { pageId } = session;
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

    recorder.reset();
    setSession(null);
    setLiveTranscript("");
    router.refresh();
  }, [recorder, router, run, session]);

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
