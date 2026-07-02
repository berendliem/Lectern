"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlashcardFlip } from "@/components/flashcards/FlashcardFlip";
import { ReviewGradeButtons } from "@/components/review/ReviewGradeButtons";

type DueCard = {
  id: string;
  prompt: string;
  idealExplanation: string;
  page: { id: string; title: string };
};

export function ReviewSession() {
  const [cards, setCards] = useState<DueCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetch("/api/review/due")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) setCards(data.cards ?? []);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function handleGrade(quality: number) {
    const card = cards?.[index];
    if (!card) return;
    await fetch(`/api/review/${card.id}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality }),
    });
    setReviewedCount((c) => c + 1);
    setFlipped(false);
    setIndex((i) => i + 1);
  }

  if (cards === null) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-16 text-center">
        <p className="text-slate-600">No cards are due for review right now.</p>
        <p className="mt-1 text-sm text-slate-400">Come back later, or generate a learning guide on a new page.</p>
      </div>
    );
  }

  if (index >= cards.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-16 text-center">
        <span className="text-3xl" aria-hidden="true">
          🎉
        </span>
        <p className="font-medium text-slate-700">
          Session complete — reviewed {reviewedCount} card{reviewedCount === 1 ? "" : "s"}.
        </p>
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          Back to your pages
        </Link>
      </div>
    );
  }

  const card = cards[index];

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4">
      <p className="text-sm text-slate-400">
        Card {index + 1} of {cards.length} ·{" "}
        <Link href={`/pages/${card.page.id}`} className="hover:text-indigo-600">
          {card.page.title}
        </Link>
      </p>
      <FlashcardFlip
        prompt={card.prompt}
        idealExplanation={card.idealExplanation}
        flipped={flipped}
        onFlip={() => setFlipped((f) => !f)}
      />
      {flipped && <ReviewGradeButtons onGrade={handleGrade} />}
    </div>
  );
}
