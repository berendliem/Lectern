"use client";

import { Fragment, useState } from "react";
import { ShortAnswerQuestion } from "@/components/quiz/ShortAnswerQuestion";
import { MultipleChoiceQuestion } from "@/components/quiz/MultipleChoiceQuestion";
import { ClozeQuestion } from "@/components/quiz/ClozeQuestion";
import { MathQuestion } from "@/components/quiz/MathQuestion";
import { QuizResultsSummary } from "@/components/quiz/QuizResultsSummary";
import { Button } from "@/components/ui/Button";

export type QuizQuestionForRunner = {
  id: string;
  type: "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "CLOZE" | "MATH";
  prompt: string;
  options: string[] | null;
};

type Feedback = {
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string | null;
};

type ResultRecord = Feedback & { prompt: string; userAnswer: string };

export function QuizRunner({ questions }: { questions: QuizQuestionForRunner[] }) {
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(answer: string) {
    const question = questions[index];
    setSubmitting(true);
    const res = await fetch(`/api/quiz/${question.id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    setSubmitting(false);
    if (!res.ok) return;
    const data: Feedback = await res.json();
    setFeedback(data);
    setResults((r) => [...r, { ...data, prompt: question.prompt, userAnswer: answer }]);
  }

  function handleNext() {
    setFeedback(null);
    setIndex((i) => i + 1);
  }

  if (questions.length === 0) return null;

  if (index >= questions.length) {
    return <QuizResultsSummary results={results} />;
  }

  const question = questions[index];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-2">
        Question {index + 1} of {questions.length}
      </p>

      {/*
        Keyed on the question, so moving to the next one remounts the input
        rather than reusing it. Without this, two questions of the same type in
        a row share a component instance — and its useState — so the answer
        typed for one appears already filled in for the next.
      */}
      <Fragment key={question.id}>
        {question.type === "MATH" ? (
          <MathQuestion prompt={question.prompt} onSubmit={handleSubmit} disabled={submitting || !!feedback} />
        ) : question.type === "SHORT_ANSWER" ? (
          <ShortAnswerQuestion prompt={question.prompt} onSubmit={handleSubmit} disabled={submitting || !!feedback} />
        ) : question.type === "CLOZE" ? (
          <ClozeQuestion prompt={question.prompt} onSubmit={handleSubmit} disabled={submitting || !!feedback} />
        ) : (
          <MultipleChoiceQuestion
            prompt={question.prompt}
            options={question.options ?? []}
            onSubmit={handleSubmit}
            disabled={submitting || !!feedback}
          />
        )}
      </Fragment>

      {feedback && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            feedback.isCorrect ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <p className="font-medium">{feedback.isCorrect ? "Correct" : "Not quite"}</p>
          {!feedback.isCorrect && <p>Correct answer: {feedback.correctAnswer}</p>}
          {feedback.explanation && <p className="mt-1 text-ink-soft">{feedback.explanation}</p>}
          <Button size="sm" onClick={handleNext} className="mt-3">
            {index + 1 < questions.length ? "Next question" : "See results"}
          </Button>
        </div>
      )}
    </div>
  );
}
