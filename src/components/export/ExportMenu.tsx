"use client";

import { useState } from "react";
import { Captions, ChevronDown, FileDown, FileText, Loader2, Send } from "lucide-react";
import clsx from "@/lib/clsx";

export function ExportMenu({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function syncToNotion() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/sync-notion`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setSyncMessage(
        res.ok
          ? body.updated
            ? "Notion page updated ✓"
            : "Synced to Notion ✓"
          : (body.error ?? "Sync failed")
      );
    } catch {
      setSyncMessage("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2"
      >
        Export
        <ChevronDown className={clsx("h-3.5 w-3.5 text-muted-2 transition-transform", open && "rotate-180")} strokeWidth={2} />
      </button>
      <div
        className={clsx(
          "absolute right-0 z-10 mt-1.5 w-44 rounded-xl border border-line bg-surface p-1 shadow-lg shadow-zinc-900/5",
          open ? "block" : "hidden"
        )}
      >
        <a
          href={`/api/pages/${pageId}/export/markdown`}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2"
        >
          <FileText className="h-4 w-4 text-muted-2" strokeWidth={2} />
          Markdown
        </a>
        <a
          href={`/api/pages/${pageId}/export/pdf`}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2"
        >
          <FileDown className="h-4 w-4 text-muted-2" strokeWidth={2} />
          PDF
        </a>
        <a
          href={`/api/pages/${pageId}/export/subtitles?format=srt`}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2"
        >
          <Captions className="h-4 w-4 text-muted-2" strokeWidth={2} />
          Subtitles (SRT)
        </a>
        <a
          href={`/api/pages/${pageId}/export/subtitles?format=vtt`}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2"
        >
          <Captions className="h-4 w-4 text-muted-2" strokeWidth={2} />
          Subtitles (VTT)
        </a>
        <button
          onClick={syncToNotion}
          disabled={syncing}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-soft hover:bg-surface-2 disabled:opacity-50"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-2" />
          ) : (
            <Send className="h-4 w-4 text-muted-2" strokeWidth={2} />
          )}
          Sync to Notion
        </button>
      </div>
      {syncMessage && (
        <p className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-right text-[12px] text-muted shadow-sm">
          {syncMessage}
        </p>
      )}
    </div>
  );
}
