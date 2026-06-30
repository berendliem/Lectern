"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadAudio, readAudioDuration } from "@/components/recording/upload";
import { Button } from "@/components/ui/Button";
import clsx from "@/lib/clsx";

export function AudioUploadDropzone({ pageId }: { pageId: string }) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    if (!file.type.startsWith("audio/")) {
      setError("Please choose an audio file (mp3, m4a, wav, webm…).");
      return;
    }
    setUploading(true);
    setError(null);
    const duration = await readAudioDuration(file);
    const result = await uploadAudio(pageId, file, file.name, duration);
    setUploading(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.error);
    }
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
        dragActive ? "border-indigo-400 bg-indigo-50" : "border-slate-300"
      )}
    >
      <p className="text-sm text-slate-500">Drag an audio file here, or</p>
      <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? "Uploading…" : "Choose file"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
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
