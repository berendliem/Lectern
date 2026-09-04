"use client";

import { useState } from "react";
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
      <p className="text-lg text-ink">{prompt}</p>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => setSelected(option)}
            disabled={disabled}
            className={clsx(
              "rounded-lg border px-4 py-2.5 text-left text-sm transition-colors",
              selected === option
                ? "border-brand bg-brand-soft text-brand"
                : "border-line bg-surface text-ink-soft hover:border-line-strong"
            )}
          >
            {option}
          </button>
        ))}
      </div>
      <Button onClick={() => selected && onSubmit(selected)} disabled={disabled || !selected} className="self-start">
        Submit
      </Button>
    </div>
  );
}
