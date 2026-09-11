"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CoursePicker } from "@/components/home/CoursePicker";
import { groupByDay, inRecordWindow, examCountdown } from "@/lib/calendar-events";
import { folderFamily, FOLDER_CHIP_CLASSES } from "@/lib/folder-colors";
import clsx from "@/lib/clsx";

export type UpNextEvent = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
  kind: "EXAM" | "ASSIGNMENT" | "CLASS" | "OTHER";
  folder: { id: string; name: string; color: string | null } | null;
};

// groupByDay parses `start` to a Date; record() only reads title/folder, so
// it takes this shape rather than UpNextEvent's ISO string.
type DayEvent = Omit<UpNextEvent, "start"> & { start: Date };

function timeLabel(start: Date, allDay: boolean): string {
  if (allDay) return "All day";
  return start.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function sinceLabel(iso: string, now: Date): string {
  const mins = Math.max(1, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

export function UpNext({
  events,
  folders,
  configured,
  lastSyncedAt,
  now: nowIso,
}: {
  events: UpNextEvent[];
  folders: { id: string; name: string }[];
  configured: boolean;
  lastSyncedAt: string | null;
  now: string;
}) {
  const now = new Date(nowIso);
  const router = useRouter();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  if (!configured) {
    return (
      <p className="text-[13px] text-muted-2">
        <Link href="/integrations" className="font-medium text-brand-ink hover:underline">
          Connect Google Calendar
        </Link>{" "}
        to see exams and classes here.
      </p>
    );
  }

  // Synced and quiet: nothing to say, so say nothing.
  if (events.length === 0 && lastSyncedAt !== null) return null;

  const groups = groupByDay(
    events.map((e) => ({ ...e, start: new Date(e.start) })),
    now
  );

  async function record(e: DayEvent) {
    setRecording(e.id);
    setRowError((r) => ({ ...r, [e.id]: "" }));
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: e.title, folderId: e.folder?.id }),
      });
      if (!res.ok) throw new Error();
      const { page } = await res.json();
      router.push(`/pages/${page.id}?record=1`);
    } catch {
      setRowError((r) => ({ ...r, [e.id]: "Could not create the page" }));
      setRecording(null);
    }
  }

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    const res = await fetch("/api/integrations/calendar/sync", { method: "POST" });
    setRetrying(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setRetryError(body.error ?? "Sync failed");
      return;
    }
    router.refresh();
  }

  return (
    <section aria-labelledby="up-next-heading" className="flex flex-col gap-3">
      <h2 id="up-next-heading" className="text-[13px] font-semibold text-ink-soft">
        Up next
      </h2>
      {groups.length > 0 && (
        <ol className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {groups.map((g) =>
            g.events.map((e, i) => {
              const family = folderFamily(e.folder?.color);
              const canRecord = e.kind === "CLASS" && inRecordWindow(e.start, now);
              return (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-20 shrink-0 text-[13px] font-semibold text-ink-soft">{i === 0 ? g.label : ""}</span>
                  <span className="w-14 shrink-0 text-[13px] tabular-nums text-muted">{timeLabel(e.start, e.allDay)}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {e.folder ? (
                      <span className={clsx("truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold", FOLDER_CHIP_CLASSES[family])}>
                        {e.folder.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPickerFor(e.id)}
                        className="text-[11px] font-medium text-muted-2 hover:text-brand-ink"
                      >
                        Add to course
                      </button>
                    )}
                    <span className="truncate text-[15px] text-ink">{e.title}</span>
                  </span>
                  {e.kind === "EXAM" && (
                    <span className="shrink-0 text-[13px] font-semibold text-gold">{examCountdown(e.start, now)}</span>
                  )}
                  {canRecord && (
                    <Button size="sm" variant="brand" disabled={recording === e.id} onClick={() => record(e)}>
                      <Mic className="h-3.5 w-3.5" strokeWidth={2.2} />
                      Record
                    </Button>
                  )}
                  {rowError[e.id] && <span className="text-[12px] font-medium text-red-700">{rowError[e.id]}</span>}
                </li>
              );
            })
          )}
        </ol>
      )}
      <div className="flex items-center justify-between text-[12px] text-muted-2">
        <span>
          {lastSyncedAt ? `Last synced ${sinceLabel(lastSyncedAt, now)}` : "Not synced yet"} ·{" "}
          <button type="button" onClick={retry} disabled={retrying} className="font-medium hover:text-brand-ink">
            {retrying ? "Syncing…" : "Retry"}
          </button>
          {retryError && <span className="ml-2 text-red-700">{retryError}</span>}
        </span>
        <Link href="/planner" className="font-medium hover:text-brand-ink">
          Planner ›
        </Link>
      </div>
      {pickerFor && <CoursePicker eventId={pickerFor} folders={folders} open onClose={() => setPickerFor(null)} />}
    </section>
  );
}
