"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function InterviewLaunch({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function start() {
    setLoading(true);
    const res = await fetch("/api/interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "LECTURE", pageId, title: `Interview: ${pageTitle}` }),
    });
    if (res.ok) {
      const { session } = await res.json();
      router.push(`/interview/${session.id}`);
    } else {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-lavender-soft bg-lavender-soft/30 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-lavender-soft text-lavender-ink">
          <MessagesSquare className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">Get interviewed on this lecture</p>
          <p className="text-[12.5px] text-muted">An AI interviewer asks adaptive questions and coaches your answers.</p>
        </div>
      </div>
      <Button variant="brand" size="sm" onClick={start} disabled={loading}>
        {loading ? "Starting…" : "Start interview"}
      </Button>
    </div>
  );
}
