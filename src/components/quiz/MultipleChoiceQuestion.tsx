"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
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

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg text-ink">
        <Markdown>{prompt}</Markdown>
      </div>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => setSelected(option)}
            disabled={disabled}
            className={clsx(
              "rounded-lg border px-4 py-2.5 text-left text-sm transition-colors [&_p]:m-0",
              selected === option
                ? "border-brand bg-brand-soft text-brand-ink"
                : "border-line bg-surface text-ink-soft hover:border-line-strong"
            )}
          >
            <Markdown>{option}</Markdown>
          </button>
        ))}
      </div>
      <Button onClick={() => selected && onSubmit(selected)} disabled={disabled || !selected} className="self-start">
        Submit
      </Button>
    </div>
  );
}
