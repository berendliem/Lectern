"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
import { keyInputFromEvent, sessionKey } from "@/lib/review-keys";
import clsx from "@/lib/clsx";

export function MultipleChoiceQuestion({
  prompt,
  options,
  onSubmit,
  disabled,
}: {
  prompt: string;
  options: string[];
  onSubmit: (answer: string) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  // A digit picks its option and Enter submits the pick. Once the question is
  // answered the runner owns Enter, so this stands down while disabled.
  const latest = useRef({ options, selected, disabled, onSubmit });
  useEffect(() => {
    latest.current = { options, selected, disabled, onSubmit };
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const state = latest.current;
      if (state.disabled) return;
      const action = sessionKey(keyInputFromEvent(e));
      if (action?.type === "digit" && state.options[action.n - 1] !== undefined) {
        setSelected(state.options[action.n - 1]);
      } else if (action?.type === "enter" && state.selected) {
        e.preventDefault();
        state.onSubmit(state.selected);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg text-ink">
        <Markdown>{prompt}</Markdown>
      </div>
      <div className="flex flex-col gap-2">
        {options.map((option, i) => (
          <button
            key={`${i}-${option}`}
            onClick={() => setSelected(option)}
            disabled={disabled}
            aria-pressed={selected === option}
            aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
            className={clsx(
              "flex items-start gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors [&_p]:m-0",
              selected === option
                ? "border-brand bg-brand-soft text-brand-ink"
                : "border-line bg-surface text-ink-soft hover:border-line-strong"
            )}
          >
            {i < 9 && (
              <kbd className="mt-0.5 shrink-0 font-sans text-[11px] opacity-50" aria-hidden="true">
                {i + 1}
              </kbd>
            )}
            <span className="min-w-0 flex-1">
              <Markdown>{option}</Markdown>
            </span>
          </button>
        ))}
      </div>
      <Button onClick={() => selected && onSubmit(selected)} disabled={disabled || !selected} className="self-start">
        Submit
      </Button>
    </div>
  );
}
