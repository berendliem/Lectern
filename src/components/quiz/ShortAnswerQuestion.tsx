"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function ShortAnswerQuestion({
  prompt,
  onSubmit,
  disabled,
}: {
  prompt: string;
  onSubmit: (answer: string) => void;
  disabled: boolean;
}) {
  const [answer, setAnswer] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg text-ink">
        <Markdown>{prompt}</Markdown>
      </div>
      <Textarea
        rows={3}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Type your answer…"
        disabled={disabled}
      />
      <Button onClick={() => onSubmit(answer)} disabled={disabled || !answer.trim()} className="self-start">
        Submit
      </Button>
    </div>
  );
}
