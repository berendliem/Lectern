"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type Question = {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

type PretestData = {
  topic: { id: string; title: string };
  questions: Question[];
};

export function PretestDialog({
  open,
  onClose,
  folderId,
  topicId,
}: {
  open: boolean;
  onClose: () => void;
  folderId: string;
  topicId: string;
}) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([null, null, null]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;

    async function fetchPretest() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/folders/${folderId}/topics/${topicId}/pretest`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Could not load the pretest. Please try again.");
          return;
        }
        const data: PretestData = await res.json();
        setQuestions(data.questions);
      } catch {
        setError("Network error talking to the local server.");
      } finally {
        setLoading(false);
      }
    }

    fetchPretest();
  }, [open, folderId, topicId]);

  async function handleSubmit() {
    if (!questions || answers.some((a) => a === null)) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders/${folderId}/topics/${topicId}/pretest/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: questions.map((q, i) => ({
            prompt: q.prompt,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
            chosenIndex: answers[i],
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Could not submit your answers. Please try again.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    // Reset state before closing
    setQuestions(null);
    setLoading(true);
    setError(null);
    setAnswers([null, null, null]);
    setSubmitting(false);
    setSubmitted(false);
    onClose();
  }

  const canSubmit = !loading && !error && questions && answers.every((a) => a !== null) && !submitting;

  return (
    <Modal open={open} onClose={handleClose} title="Prediction Questions">
      <div className="flex flex-col gap-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6">
            <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
            <span className="text-sm text-muted-2">Loading questions…</span>
          </div>
        )}

        {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}

        {submitted && (
          <div className="flex flex-col gap-3 py-4">
            <p className="text-sm text-ink">Your answers are being held. They will be revealed alongside the lecture notes after you complete the lesson.</p>
            <Button onClick={handleClose} className="w-full">
              Close
            </Button>
          </div>
        )}

        {!loading && !error && !submitted && questions && (
          <div className="flex flex-col gap-5">
            {questions.map((question, qIndex) => (
              <div key={qIndex} className="flex flex-col gap-3">
                <p className="text-sm font-medium text-ink">
                  {qIndex + 1}. {question.prompt}
                </p>
                <div className="flex flex-col gap-2 pl-2">
                  {question.options.map((option, oIndex) => (
                    <label key={oIndex} className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name={`question-${qIndex}`}
                        value={oIndex}
                        checked={answers[qIndex] === oIndex}
                        onChange={() => {
                          const newAnswers = [...answers];
                          newAnswers[qIndex] = oIndex;
                          setAnswers(newAnswers);
                        }}
                        className="mt-0.5"
                        disabled={submitting}
                      />
                      <span className="text-sm text-ink-soft">{option}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full mt-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={2} />
                  Submitting…
                </>
              ) : (
                "Submit Answers"
              )}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
