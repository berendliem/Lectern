"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";

export function InterviewStartForm({
  initialTopic = "",
  initialTitle = "",
}: {
  /** Pre-filled when the interview was launched from a course. */
  initialTopic?: string;
  initialTitle?: string;
}) {
  const [topic, setTopic] = useState(initialTopic);
  const [title, setTitle] = useState(initialTitle);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "TOPIC", topicText: topic.trim(), title: title.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start the interview.");
        setSubmitting(false);
        return;
      }
      router.push(`/interview/${data.session.id}`);
    } catch {
      setError("Network error talking to the local server.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={start}
      className="flex flex-col gap-3 rounded-2xl border border-brand-border bg-gradient-to-br from-brand-soft/70 to-lavender-soft/40 p-5"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-brand-ink shadow-sm">
          <Sparkles className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">Start from a topic or job description</p>
          <p className="text-[12.5px] text-muted">Paste anything you want to be grilled on — a subject, a role, a JD.</p>
        </div>
      </div>
      <Textarea
        rows={4}
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="e.g. Frontend engineer role focused on React and system design — ask me behavioral and technical questions."
        disabled={submitting}
        className="bg-surface"
      />
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        disabled={submitting}
        className="bg-surface"
      />
      {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}
      <Button type="submit" variant="brand" disabled={submitting || !topic.trim()} className="self-start">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Sparkles className="h-4 w-4" strokeWidth={2} />}
        {submitting ? "Preparing…" : "Start interview"}
      </Button>
    </form>
  );
}
