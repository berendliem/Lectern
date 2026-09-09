"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { ShortAnswerQuestion } from "@/components/quiz/ShortAnswerQuestion";
import { MultipleChoiceQuestion } from "@/components/quiz/MultipleChoiceQuestion";
import type { LessonScene } from "@/lib/lesson";

type QuizQuestion = {
  id: string;
  type: "SHORT_ANSWER" | "MULTIPLE_CHOICE";
  prompt: string;
  correctAnswer: string;
  options: string[] | null;
  explanation: string | null;
};

type LessonData = {
  topic: { id: string; title: string };
  pageId: string | null;
  scenes: LessonScene[];
  quizQuestion: QuizQuestion | null;
};

type RecallFeedback = {
  covered: string[];
  missed: string[];
  wrong: { claim: string; correction: string }[];
};

type RecallResult = {
  feedback: RecallFeedback;
  quality: number;
  cardsCreated: number;
};

type QuizResult = {
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string | null;
};

export function LessonRunner({ folderId, topicId, topicTitle }: { folderId: string; topicId: string; topicTitle: string }) {
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [recallResult, setRecallResult] = useState<RecallResult | null>(null);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [recallText, setRecallText] = useState("");
  const [recallSubmitting, setRecallSubmitting] = useState(false);
  const [quizSubmitting, setQuizSubmitting] = useState(false);

  useEffect(() => {
    async function fetchLesson() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/folders/${folderId}/topics/${topicId}/lesson`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Could not generate the lesson. Please try again.");
          return;
        }
        const data: LessonData = await res.json();
        setLesson(data);
      } catch {
        setError("Network error talking to the local server.");
      } finally {
        setLoading(false);
      }
    }
    fetchLesson();
  }, [folderId, topicId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
        <span className="text-sm text-muted-2">Generating lesson…</span>
      </div>
    );
  }

  if (error) {
    return <p className="text-[13px] font-medium text-red-700">{error}</p>;
  }

  if (!lesson) {
    return null;
  }

  const { scenes, pageId, quizQuestion } = lesson;
  if (scenes.length === 0) {
    return <p className="text-sm text-muted-2">No scenes available.</p>;
  }

  const scene = scenes[sceneIndex];
  const isLastScene = sceneIndex === scenes.length - 1;

  async function handleRecallSubmit() {
    if (!scene.prompt || recallText.trim().length === 0) return;

    setRecallSubmitting(true);
    setError(null);
    try {
      if (!pageId) {
        // No lecture behind this topic — accept but don't grade
        setRecallResult({
          feedback: { covered: [], missed: [], wrong: [] },
          quality: 0,
          cardsCreated: 0,
        });
        return;
      }

      const res = await fetch(`/api/pages/${pageId}/blurt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dump: recallText }),
      });

      if (!res.ok) {
        setError("Could not submit your answer. Please try again.");
        return;
      }

      const data: RecallResult = await res.json();
      setRecallResult(data);
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setRecallSubmitting(false);
    }
  }

  async function handleTeachStart() {
    setError(null);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "COURSE_TOPIC", courseTopicId: topicId, mode: "PROTEGE" }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Could not start the session. Please try again.");
        return;
      }

      const data = await res.json();
      window.open(`/interview/${data.session.id}`, "_blank", "noopener,noreferrer");
    } catch {
      setError("Network error talking to the local server.");
    }
  }

  async function handleQuizSubmit(answer: string) {
    if (!quizQuestion) return;

    setQuizSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/quiz/${quizQuestion.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });

      if (!res.ok) {
        setError("Could not submit your answer. Please try again.");
        return;
      }

      const data: QuizResult = await res.json();
      setQuizResult(data);
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setQuizSubmitting(false);
    }
  }

  function handleNext() {
    setRecallResult(null);
    setQuizResult(null);
    setRecallText("");
    setSceneIndex((i) => i + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm text-muted-2">
          Scene {sceneIndex + 1} of {scenes.length}
        </p>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-[#9b5cff] transition-all"
            style={{ width: `${((sceneIndex + 1) / scenes.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-semibold text-ink">{scene.title}</h3>
          <p className="mt-1 text-xs uppercase tracking-wide text-muted-2">{scene.kind}</p>
        </div>

        {scene.kind === "RECALL" && (
          <div className="flex flex-col gap-3">
            {scene.prompt && <p className="text-[15px] leading-6 text-ink">{scene.prompt}</p>}

            <div className="flex flex-col gap-2">
              <label htmlFor="recall-input" className="text-xs font-semibold uppercase tracking-wide text-brand-ink">
                Your answer
              </label>
              <Textarea
                id="recall-input"
                rows={4}
                value={recallText}
                onChange={(e) => setRecallText(e.target.value)}
                placeholder="Write what you remember…"
                disabled={recallSubmitting || !!recallResult}
              />
            </div>

            {recallResult && (
              <div className="rounded-lg border border-surface-3 bg-surface p-4">
                {!pageId && (
                  <p className="mb-3 text-[13px] text-ink-soft">
                    <span className="font-medium">Note:</span> This topic has no lecture behind it, so your answer wasn&rsquo;t graded.
                  </p>
                )}
                {pageId && recallResult.cardsCreated > 0 && (
                  <p className="mb-3 text-[13px] font-medium text-moss-ink">
                    Created {recallResult.cardsCreated} flashcard{recallResult.cardsCreated !== 1 ? "s" : ""} from gaps.
                  </p>
                )}

                {recallResult.feedback.covered.length > 0 && (
                  <div className="mb-3 text-[13px] text-ink-soft">
                    <p className="font-medium text-moss-ink">You covered:</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {recallResult.feedback.covered.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {recallResult.feedback.missed.length > 0 && (
                  <div className="mb-3 text-[13px] text-ink-soft">
                    <p className="font-medium text-daisy-ink">You missed:</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {recallResult.feedback.missed.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {recallResult.feedback.wrong.length > 0 && (
                  <div className="text-[13px] text-ink-soft">
                    <p className="font-medium text-red-700">Clarifications:</p>
                    <ul className="mt-1 space-y-1">
                      {recallResult.feedback.wrong.map((item, i) => (
                        <li key={i}>
                          <strong>{item.claim}:</strong> {item.correction}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {!recallResult && (
              <Button
                onClick={handleRecallSubmit}
                disabled={recallSubmitting || !recallText.trim()}
                className="self-start"
              >
                {recallSubmitting && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
                {recallSubmitting ? "Submitting…" : "Submit"}
              </Button>
            )}
          </div>
        )}

        {scene.kind === "EXPLAIN" && (
          <div className="flex flex-col gap-3">
            {scene.body && (
              <div className="rounded-lg border border-surface-3 bg-surface p-4">
                <p className="text-[15px] leading-6 text-ink">{scene.body}</p>
              </div>
            )}
            {scene.citation && <p className="text-xs text-muted-2">— {scene.citation}</p>}
          </div>
        )}

        {scene.kind === "TEACH" && (
          <div>
            <p className="mb-3 text-[15px] leading-6 text-ink-soft">
              Let&rsquo;s have a dialogue about <span className="font-medium">{topicTitle}</span>. I&rsquo;ll guide you through your thinking.
            </p>
            <Button onClick={handleTeachStart} className="self-start">
              Start dialogue (opens in new tab)
            </Button>
          </div>
        )}

        {scene.kind === "CHECK" && quizQuestion && (
          <div className="flex flex-col gap-3">
            {quizQuestion.type === "SHORT_ANSWER" ? (
              <ShortAnswerQuestion
                prompt={quizQuestion.prompt}
                onSubmit={handleQuizSubmit}
                disabled={quizSubmitting || !!quizResult}
              />
            ) : (
              <MultipleChoiceQuestion
                prompt={quizQuestion.prompt}
                options={quizQuestion.options ?? []}
                onSubmit={handleQuizSubmit}
                disabled={quizSubmitting || !!quizResult}
              />
            )}

            {quizResult && (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  quizResult.isCorrect ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                <p className="font-medium">{quizResult.isCorrect ? "Correct" : "Not quite"}</p>
                {!quizResult.isCorrect && <p>Correct answer: {quizResult.correctAnswer}</p>}
                {quizResult.explanation && <p className="mt-1 text-ink-soft">{quizResult.explanation}</p>}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}
      </div>

      {(recallResult || scene.kind === "EXPLAIN" || scene.kind === "TEACH" || quizResult) && (
        <Button
          onClick={handleNext}
          className="self-end"
        >
          {isLastScene ? "Lesson complete" : "Next scene"}
        </Button>
      )}
    </div>
  );
}
