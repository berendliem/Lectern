"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { transcribePage } from "@/components/recording/upload";
import { useTasks } from "@/components/tasks/TaskProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { postTask } from "@/lib/tasks";

/**
 * Attaches a lecture that lives at a URL. The server does the fetching, so the
 * page ends up in exactly the state an upload leaves it in and the rest of the
 * pipeline is none the wiser.
 *
 * Both the download and the transcription run as tasks, so a long lecture keeps
 * going when the user leaves the page and reports back in the header.
 */
export function UrlImport({ pageId }: { pageId: string }) {
  const router = useRouter();
  const { run, task, clear } = useTasks();
  const [url, setUrl] = useState("");
  const fetchKey = `page:${pageId}:audio-from-url`;
  const busy = task(fetchKey)?.status === "running";
  const error = task(fetchKey)?.error ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    clear([fetchKey]);
    const fetched = await run(
      { key: fetchKey, label: "Fetching the lecture audio…", href: `/pages/${pageId}` },
      async () => {
        await postTask(
          `/api/pages/${pageId}/audio/from-url`,
          "Could not fetch that link.",
          { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) },
          // A long download on a flaky connection rejects rather than answering.
          "The connection dropped before the audio arrived. Try the link again."
        );
      }
    );
    // `ran: false` is a double submit: the run it joined carries on from here.
    if (!fetched.ran || fetched.status === "error") return;

    setUrl("");
    // The refresh swaps this form for the pipeline banner, which owns the
    // transcribe key below and shows its progress and any failure with a retry.
    router.refresh();
    await run(
      { key: `page:${pageId}:transcribe`, label: "Transcribing audio…", href: `/pages/${pageId}` },
      async () => {
        const transcribed = await transcribePage(pageId);
        if (!transcribed.ok) throw new Error(transcribed.error);
      }
    );
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
          {busy ? "Fetching…" : "Fetch"}
        </Button>
      </div>
      <p className="text-[13px] text-muted-2">
        Downloads just the audio and replaces whatever audio this page already has. A long lecture takes a while; it
        keeps going if you leave this page.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
