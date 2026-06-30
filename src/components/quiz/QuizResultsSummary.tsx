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
      <p className="text-lg font-medium text-slate-900">
        You scored {correctCount} / {results.length}
      </p>
      <ul className="flex flex-col gap-2">
        {results
          .filter((r) => !r.isCorrect)
          .map((r, i) => (
            <li key={i} className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-medium text-slate-900">{r.prompt}</p>
              <p className="mt-1 text-sm text-slate-600">Your answer: {r.userAnswer}</p>
              <p className="text-sm text-emerald-700">Correct answer: {r.correctAnswer}</p>
              {r.explanation && <p className="mt-1 text-sm text-slate-500">{r.explanation}</p>}
            </li>
          ))}
      </ul>
    </div>
  );
}
