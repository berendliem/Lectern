"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, CalendarPlus, Lightbulb, Loader2, Timer } from "lucide-react";
import { BlurtPanel } from "@/components/flashcards/BlurtPanel";

const LINK_CLASSES =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand-border hover:bg-brand-soft/40 hover:text-brand-ink";

/**
 * The lecture-tier entry points: every one of these features works better when
 * it starts from what you just studied instead of a blank slate.
 */
export function LectureActions({ pageId }: { pageId: string }) {
  const [scheduling, setScheduling] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function scheduleReview() {
    setScheduling(true);
    setResult(null);
    try {
      const res = await fetch("/api/integrations/calendar/schedule-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      const body = await res.json().catch(() => ({}));
      setResult(
        res.ok
          ? `Added review sessions for: ${body.createdDays.join(", ")}`
          : (body.error ?? "Scheduling failed")
      );
    } catch {
      setResult("Scheduling failed");
    } finally {
      setScheduling(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <BlurtPanel pageId={pageId} className={LINK_CLASSES} />
        <Link href={`/feynman?pageId=${pageId}`} className={LINK_CLASSES}>
          <Lightbulb className="h-3.5 w-3.5" strokeWidth={2.2} /> Feynman coach
        </Link>
        <Link href={`/focus?pageId=${pageId}`} className={LINK_CLASSES}>
          <Timer className="h-3.5 w-3.5" strokeWidth={2.2} /> Focus timer
        </Link>
        <Link href={`/dictionary?pageId=${pageId}`} className={LINK_CLASSES}>
          <BookOpen className="h-3.5 w-3.5" strokeWidth={2.2} /> Dictionary
        </Link>
        <button onClick={scheduleReview} disabled={scheduling} className={LINK_CLASSES}>
          {scheduling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
          ) : (
            <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2.2} />
          )}
          Schedule review
        </button>
      </div>
      {result && <p className="text-[12.5px] text-muted">{result}</p>}
    </div>
  );
}
