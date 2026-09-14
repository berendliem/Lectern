"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { splitCloze } from "@/lib/cloze";

/**
 * A fill-in-the-blank question. The input sits inline where the term was
 * removed, so the sentence around it stays readable as a sentence — the
 * surrounding words are the context the recall is meant to hang on.
 */
export function ClozeQuestion({
  prompt,
  onSubmit,
  disabled,
}: {
  prompt: string;
  onSubmit: (answer: string) => void;
  disabled: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const { before, after } = splitCloze(prompt);
  const submit = () => onSubmit(answer);

  return (
    <div className="flex flex-col gap-3">
      <span className="block text-lg leading-relaxed text-ink [&_p]:m-0 [&_p]:inline">
        <Markdown>{before}</Markdown>
        <Input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && answer.trim() && !disabled) submit();
          }}
          disabled={disabled}
          aria-label="Your answer for the blank"
          placeholder="…"
          className="mx-1 inline-block w-40 align-baseline"
        />
        <Markdown>{after}</Markdown>
      </span>
      <Button onClick={submit} disabled={disabled || !answer.trim()} className="self-start">
        Submit
      </Button>
    </div>
  );
}
