"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

/**
 * A question whose answer is a value. One line rather than a textarea, because
 * an eigenvalue is not a paragraph, and a placeholder that states the notation
 * contract — the grader reads ASCII, and nothing else tells the student that.
 */
export function MathQuestion({
  prompt,
  onSubmit,
  disabled,
}: {
  prompt: string;
  onSubmit: (answer: string) => void;
  disabled: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const submit = () => onSubmit(answer);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg text-ink">
        <Markdown>{prompt}</Markdown>
      </div>
      <Input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && answer.trim() && !disabled) submit();
        }}
        disabled={disabled}
        aria-label="Your answer"
        placeholder="e.g. 1/2, x^2+1, [[1,2],[3,4]], {2,3,5}"
      />
      <Button onClick={submit} disabled={disabled || !answer.trim()} className="self-start">
        Submit
      </Button>
    </div>
  );
}
