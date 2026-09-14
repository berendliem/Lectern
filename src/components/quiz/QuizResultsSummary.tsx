import { blankCloze } from "@/lib/cloze";
import { Markdown } from "@/components/Markdown";

type Result = {
  prompt: string;
  isCorrect: boolean;
  userAnswer: string;
  correctAnswer: string;
  explanation: string | null;
};

export function QuizResultsSummary({ results }: { results: Result[] }) {
  const correctCount = results.filter((r) => r.isCorrect).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg font-medium text-ink">
        You scored {correctCount} / {results.length}
      </p>
      <ul className="flex flex-col gap-2">
        {results
          .filter((r) => !r.isCorrect)
          .map((r, i) => (
            <li key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 [&_p]:m-0">
              <div className="text-sm font-medium text-ink">
                <Markdown>{blankCloze(r.prompt)}</Markdown>
              </div>
              {/* Literal, not markdown: a MATH answer is an ASCII expression
                  full of `*`, and CommonMark's intraword emphasis silently
                  turns `2*x*y` into `2xy`. The prompt and the explanation
                  below stay markdown — those are prose and carry LaTeX. */}
              <div className="mt-1 flex gap-1 text-sm text-ink-soft">
                <span>Your answer:</span>
                <code className="font-mono">{r.userAnswer}</code>
              </div>
              <div className="flex gap-1 text-sm text-emerald-700">
                <span>Correct answer:</span>
                <code className="font-mono">{r.correctAnswer}</code>
              </div>
              {r.explanation && (
                <div className="mt-1 text-sm text-muted">
                  <Markdown>{r.explanation}</Markdown>
                </div>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}
