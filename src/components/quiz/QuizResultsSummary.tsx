import { blankCloze } from "@/lib/cloze";
import { Markdown } from "@/components/Markdown";

type Result = {
  id: string;
  prompt: string;
  isCorrect: boolean;
  score: number;
  attempt: number;
  userAnswer: string;
  correctAnswer: string;
  explanation: string | null;
};

/**
 * One row per question, not per attempt: a question that took three goes to
 * get right is one question the student now knows, and scoring it three times
 * would bury a nine-question quiz under twenty rows.
 */
function lastAttempts(results: Result[]): Result[] {
  const byQuestion = new Map<string, Result>();
  for (const r of results) {
    const seen = byQuestion.get(r.id);
    if (!seen || r.attempt > seen.attempt) byQuestion.set(r.id, r);
  }
  return [...byQuestion.values()];
}

export function QuizResultsSummary({ results }: { results: Result[] }) {
  const final = lastAttempts(results);
  const correctCount = final.filter((r) => r.isCorrect).length;
  const retried = final.filter((r) => r.attempt > 1 && r.isCorrect).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg font-medium text-ink">
        You scored {correctCount} / {final.length}
      </p>
      {retried > 0 && (
        <p className="-mt-3 text-sm text-muted-2">
          {retried} of those took more than one go — that repetition is the part that sticks.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {final
          .filter((r) => !r.isCorrect)
          .map((r) => (
            <li key={r.id} className="rounded-lg border border-red-200 bg-red-50 p-3 [&_p]:m-0">
              <div className="text-sm font-medium text-ink">
                <Markdown>{blankCloze(r.prompt)}</Markdown>
              </div>
              <p className="mt-0.5 text-[13px] text-muted-2">
                Still unmastered after {r.attempt} {r.attempt === 1 ? "try" : "tries"} — last score {r.score}/100.
              </p>
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
