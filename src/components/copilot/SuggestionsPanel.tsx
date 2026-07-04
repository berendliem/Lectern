"use client";

import { Lightbulb, ListChecks, Loader2, MessageCircleQuestion, TriangleAlert } from "lucide-react";
import clsx from "@/lib/clsx";
import type { CopilotSuggestion } from "@/lib/copilot";

function SuggestionCard({
  title,
  icon,
  iconClasses,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  iconClasses: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", iconClasses)}>
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-zinc-400">{children}</p>;
}

export function SuggestionsPanel({
  suggestion,
  loading,
  error,
}: {
  suggestion: CopilotSuggestion | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-blush-ink/20 bg-blush-soft px-3.5 py-2.5 text-[13px] text-blush-ink">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <span>{error}</span>
        </div>
      )}

      <SuggestionCard
        title="Talking points"
        icon={<Lightbulb className="h-4 w-4" strokeWidth={2} />}
        iconClasses="bg-daisy-soft text-daisy-ink"
      >
        {suggestion && suggestion.talkingPoints.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-[13.5px] leading-5 text-zinc-700">
            {suggestion.talkingPoints.map((point, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-daisy-ink" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyHint>
            {loading ? "Thinking…" : "Talking points will show up here once there is enough transcript."}
          </EmptyHint>
        )}
      </SuggestionCard>

      <SuggestionCard
        title="Likely follow-ups"
        icon={<MessageCircleQuestion className="h-4 w-4" strokeWidth={2} />}
        iconClasses="bg-lavender-soft text-lavender-ink"
      >
        {suggestion && suggestion.followUps.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-[13.5px] leading-5 text-zinc-700">
            {suggestion.followUps.map((question, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lavender-ink" />
                <span>{question}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyHint>
            {loading ? "Thinking…" : "Likely follow-up questions will appear here as the conversation develops."}
          </EmptyHint>
        )}
      </SuggestionCard>

      <SuggestionCard
        title="Running summary"
        icon={<ListChecks className="h-4 w-4" strokeWidth={2} />}
        iconClasses="bg-moss-soft text-moss-ink"
      >
        {suggestion?.summary ? (
          <p className="text-[13.5px] leading-5 text-zinc-700">{suggestion.summary}</p>
        ) : (
          <EmptyHint>{loading ? "Thinking…" : "A running summary will appear here."}</EmptyHint>
        )}
      </SuggestionCard>

      {loading && (
        <div className="flex items-center gap-1.5 text-[12.5px] text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          Updating suggestions…
        </div>
      )}
    </div>
  );
}
