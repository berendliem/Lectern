"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { transcribePage } from "@/components/recording/upload";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Attaches a lecture that lives at a URL. The server does the fetching, so the
 * page ends up in exactly the state an upload leaves it in and the rest of the
 * pipeline is none the wiser.
 */
export function UrlImport({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "fetching" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = state !== "idle";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setState("fetching");
    setError(null);
    const res = await fetch(`/api/pages/${pageId}/audio/from-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not fetch that link.");
      setState("idle");
      return;
    }

    setUrl("");
    router.refresh();
    setState("transcribing");
    const transcribed = await transcribePage(pageId);
    setState("idle");
    if (!transcribed.ok) setError(transcribed.error);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-2" strokeWidth={2} />
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="…or paste a link to the recording"
          disabled={busy}
          aria-label="Link to a lecture recording"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={busy || !url.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
          {state === "fetching" ? "Fetching…" : state === "transcribing" ? "Transcribing…" : "Fetch"}
        </Button>
      </div>
      <p className="text-[13px] text-muted-2">
        Downloads just the audio and replaces whatever audio this page already has. A long lecture takes a while, and
        there is no progress to watch yet.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
