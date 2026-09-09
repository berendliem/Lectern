"use client";

import { Check, X } from "lucide-react";

export type PretestRevealEntry = {
  topicTitle: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  chosenIndex: number;
  explanation: string;
};

export function PretestReveal({ entries }: { entries: PretestRevealEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface px-4 py-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-2">
          Your predictions before the lecture
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted-2">
          You answered these before the lesson; here&rsquo;s how you did.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {entries.map((entry, idx) => {
          const isCorrect = entry.chosenIndex === entry.correctIndex;
          return (
            <li key={idx} className="rounded-lg border border-surface-3 bg-surface-2 p-3">
              <div className="flex gap-2">
                <div className="mt-0.5 shrink-0">
                  {isCorrect ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-moss-soft">
                      <Check className="h-4 w-4 text-moss-ink" strokeWidth={2.4} />
                    </div>
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100">
                      <X className="h-4 w-4 text-red-600" strokeWidth={2.4} />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-2 mb-2">
                    {entry.topicTitle}
                  </p>
                  <p className="text-[13px] font-medium text-ink mb-2">{entry.prompt}</p>

                  <div className="flex flex-col gap-1.5 text-[12.5px]">
                    <div className="flex gap-2">
                      <span className="text-muted-2">You said:</span>
                      <span className={isCorrect ? "text-moss-ink font-medium" : "text-red-600"}>
                        {entry.options[entry.chosenIndex]}
                      </span>
                    </div>
                    {!isCorrect && (
                      <div className="flex gap-2">
                        <span className="text-muted-2">Correct:</span>
                        <span className="text-moss-ink font-medium">{entry.options[entry.correctIndex]}</span>
                      </div>
                    )}
                  </div>

                  {entry.explanation && (
                    <p className="mt-2 text-[12.5px] text-ink-soft leading-relaxed">{entry.explanation}</p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
