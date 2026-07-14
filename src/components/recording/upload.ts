export async function uploadAudio(
  pageId: string,
  blob: Blob,
  filename: string,
  durationSeconds?: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const formData = new FormData();
  formData.append("file", blob, filename);
  if (durationSeconds !== undefined && Number.isFinite(durationSeconds)) {
    formData.append("durationSeconds", String(durationSeconds));
  }

  const res = await fetch(`/api/pages/${pageId}/audio`, { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? "Upload failed" };
  }
  return { ok: true };
}

export async function transcribePage(pageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`/api/pages/${pageId}/transcribe`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? "Transcription failed" };
  }
  return { ok: true };
}

export function readAudioDuration(file: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    // A <video> element reads metadata for both audio and video containers.
    const el = document.createElement("video");
    el.preload = "metadata";
    const cleanup = () => URL.revokeObjectURL(url);
    el.addEventListener("loadedmetadata", () => {
      cleanup();
      resolve(Number.isFinite(el.duration) ? el.duration : undefined);
    });
    el.addEventListener("error", () => {
      cleanup();
      resolve(undefined);
    });
    el.src = url;
  });
}
