"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCheck, PartyPopper } from "lucide-react";
import { FlashcardFlip } from "@/components/flashcards/FlashcardFlip";
import { ReviewGradeButtons } from "@/components/review/ReviewGradeButtons";

type DueCard = {
  id: string;
  prompt: string;
  idealExplanation: string;
  page: { id: string; title: string } | null;
  material: { id: string; title: string } | null;
};

export function ReviewSession({ folderId }: { folderId?: string }) {
  const [cards, setCards] = useState<DueCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    const url = folderId ? `/api/review/due?folderId=${encodeURIComponent(folderId)}` : "/api/review/due";
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) setCards(data.cards ?? []);
      });
    return () => {
      ignore = true;
    };
  }, [folderId]);

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
    return <p className="text-sm text-zinc-400">Loading…</p>;
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-moss-soft text-moss-ink">
          <CheckCheck className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-zinc-700">All caught up</p>
          <p className="mt-1 text-[13px] text-zinc-400">No cards are due right now — come back later.</p>
        </div>
      </div>
    );
  }

  if (index >= cards.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <PartyPopper className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-zinc-700">
            Session complete — {reviewedCount} card{reviewedCount === 1 ? "" : "s"} reviewed.
          </p>
          <Link href="/" className="mt-1 inline-block text-[13px] font-medium text-brand hover:underline">
            Back to your library
          </Link>
        </div>
      </div>
    );
  }

  const card = cards[index];
  const progress = (index / cards.length) * 100;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5">
      <div className="w-full">
        <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
          <span>
            Card {index + 1} of {cards.length}
          </span>
          {card.page ? (
            <Link href={`/pages/${card.page.id}`} className="truncate font-medium hover:text-brand">
              {card.page.title}
            </Link>
          ) : card.material ? (
            <span className="truncate font-medium">{card.material.title}</span>
          ) : (
            <span className="truncate font-medium text-zinc-400">Unknown source</span>
          )}
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>
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
