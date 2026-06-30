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
      <p className="text-lg text-slate-900">{prompt}</p>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => setSelected(option)}
            disabled={disabled}
            className={clsx(
              "rounded-lg border px-4 py-2.5 text-left text-sm transition-colors",
              selected === option
                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
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
