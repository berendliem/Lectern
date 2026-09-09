"use client";

import { useState } from "react";
import { Loader2, MessageSquarePlus, Swords } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { DEBATE_AGENTS, MAX_DEBATE_EXCHANGES, STUDENT_SPEAKER, exchangeCount } from "@/lib/debate";
import type { InterviewFeedback } from "@/lib/interview";
import clsx from "@/lib/clsx";

type Turn = {
  id: string;
  order: number;
  speaker: string | null;
  question: string;
  answer: string | null;
  /**
   * A row loaded from the server carries feedback as the raw JSON string
   * Prisma stored; a turn just appended from the interject response already
   * carries the parsed object. Both are valid — see parseFeedback below.
   */
  feedback: string | InterviewFeedback | null;
  /** Set only when grading the interjection failed but the turn was kept. */
  gradeError?: string | null;
};

function parseFeedback(feedback: string | InterviewFeedback | null): InterviewFeedback | null {
  if (feedback === null) return null;
  return typeof feedback === "string" ? (JSON.parse(feedback) as InterviewFeedback) : feedback;
}

export function DebateRunner({
  sessionId,
  concept,
  initialTurns,
  status,
}: {
  sessionId: string;
  concept: string;
  initialTurns: Turn[];
  status: "ACTIVE" | "COMPLETED";
}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [done, setDone] = useState(status === "COMPLETED");
  const [advancing, setAdvancing] = useState(false);
  const [interjection, setInterjection] = useState("");
  const [interjecting, setInterjecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exchanges = exchangeCount(turns);

  async function advance() {
    setAdvancing(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview/${sessionId}/debate/advance`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not advance the debate.");
        return;
      }
      setTurns((t) => [...t, ...data.turns]);
      if (data.done) setDone(true);
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setAdvancing(false);
    }
  }

  async function interject() {
    const text = interjection.trim();
    if (!text) return;
    setInterjecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview/${sessionId}/debate/interject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save your interjection.");
        return;
      }
      // The point was saved either way — only the grade is missing when
      // `feedback` comes back null with an `error` alongside it.
      setTurns((t) => [...t, { ...data.turn, feedback: data.feedback, gradeError: data.error ?? null }]);
      setInterjection("");
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setInterjecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-2">
          <span className="flex items-center gap-1.5">
            <Swords className="h-3.5 w-3.5" strokeWidth={2.2} />
            {DEBATE_AGENTS.join(" vs ")}
          </span>
          <span className="truncate font-medium">{concept}</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-[#9b5cff] transition-all"
            style={{ width: `${(exchanges / MAX_DEBATE_EXCHANGES) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {turns.length === 0 && (
          <p className="text-sm text-muted-2">No exchanges yet. Click Advance to start the debate.</p>
        )}
        {turns.map((turn) => {
          const isStudent = turn.speaker === STUDENT_SPEAKER;
          const text = isStudent ? turn.answer : turn.question;
          const feedback = parseFeedback(turn.feedback);
          return (
            <div
              key={turn.id}
              className={clsx(
                "rounded-2xl border border-line/80 p-4",
                isStudent ? "bg-daisy-soft/50" : "bg-surface"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink">
                  {turn.speaker ?? "Interviewer"}
                </p>
                {feedback && (
                  <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink">
                    {feedback.score}/5
                  </span>
                )}
              </div>
              <p className="mt-1 text-[15px] leading-6 text-ink">{text}</p>
              {feedback && (
                <p className="mt-2 text-[13px] leading-5 text-ink-soft">
                  <span className="font-medium text-moss-ink">Strength:</span> {feedback.strengths[0]}
                  {feedback.improvements[0] && (
                    <>
                      {" "}
                      · <span className="font-medium text-daisy-ink">To improve:</span> {feedback.improvements[0]}
                    </>
                  )}
                </p>
              )}
              {turn.gradeError && (
                <p className="mt-2 text-[13px] font-medium text-red-700">{turn.gradeError}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted-2">
          {exchanges} / {MAX_DEBATE_EXCHANGES} exchanges
        </span>
        <Button variant="brand" size="sm" onClick={advance} disabled={advancing || done}>
          {advancing && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
          {done ? "Debate complete" : advancing ? "Advancing…" : "Advance"}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="debate-interjection" className="text-xs font-semibold uppercase tracking-wide text-brand-ink">
          Your interjection
        </label>
        <Textarea
          id="debate-interjection"
          rows={3}
          value={interjection}
          onChange={(e) => setInterjection(e.target.value)}
          placeholder="Jump in with your own point…"
          disabled={interjecting}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={interject}
          disabled={interjecting || !interjection.trim()}
          className="self-start"
        >
          {interjecting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <MessageSquarePlus className="h-4 w-4" strokeWidth={2} />}
          {interjecting ? "Sending…" : "Interject"}
        </Button>
      </div>

      {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}
    </div>
  );
}
