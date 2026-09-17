"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadAudio, readAudioDuration, transcribePage } from "@/components/recording/upload";
import { useTasks } from "@/components/tasks/TaskProvider";
import { Button } from "@/components/ui/Button";
import clsx from "@/lib/clsx";

export function AudioUploadDropzone({ pageId }: { pageId: string }) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { run, task } = useTasks();
  const transcribeKey = `page:${pageId}:transcribe`;
  const transcribing = task(transcribeKey)?.status === "running";

  async function handleFile(file: File) {
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      setError("Please choose an audio or video file (mp3, m4a, wav, mp4, mov…).");
      return;
    }
    setUploading(true);
    setError(null);
    const duration = await readAudioDuration(file);
    const result = await uploadAudio(pageId, file, file.name, duration);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // The refresh swaps this dropzone for the pipeline banner, which owns the
    // transcribe key and reports progress or a failure with a retry — so a long
    // transcription survives the user leaving the page.
    router.refresh();
    await run(
      { key: transcribeKey, label: "Transcribing audio…", href: `/pages/${pageId}` },
      async () => {
        const transcribed = await transcribePage(pageId);
        if (!transcribed.ok) throw new Error(transcribed.error);
      }
    );
    router.refresh();
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
      className={clsx(
        "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
        dragActive ? "border-brand-border bg-brand-soft" : "border-line-strong"
      )}
    >
      <p className="text-sm text-muted">Drag an audio or video file here, or</p>
      <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading || transcribing}>
        {uploading ? "Uploading…" : transcribing ? "Transcribing…" : "Choose file"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
