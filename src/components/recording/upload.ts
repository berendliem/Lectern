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

export function readAudioDuration(file: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    const cleanup = () => URL.revokeObjectURL(url);
    audio.addEventListener("loadedmetadata", () => {
      cleanup();
      resolve(Number.isFinite(audio.duration) ? audio.duration : undefined);
    });
    audio.addEventListener("error", () => {
      cleanup();
      resolve(undefined);
    });
  });
}
