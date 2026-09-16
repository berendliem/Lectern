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
  const canSubmit = !disabled && answer.trim().length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg text-ink">
        <Markdown>{prompt}</Markdown>
      </div>
      <Textarea
        rows={3}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        // Plain Enter stays a newline: an answer can be a paragraph.
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
            e.preventDefault();
            onSubmit(answer);
          }
        }}
        placeholder="Type your answer… (⌘Enter to submit)"
        disabled={disabled}
      />
      <Button onClick={() => onSubmit(answer)} disabled={!canSubmit} className="self-start">
        Submit
      </Button>
    </div>
  );
}
