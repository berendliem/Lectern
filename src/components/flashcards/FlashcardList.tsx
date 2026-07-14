import { Badge } from "@/components/ui/Badge";
import { masteryOf, MASTERY_LABEL, MASTERY_CLASSES } from "@/lib/mastery";
import clsx from "@/lib/clsx";

export type FlashcardListItem = {
  id: string;
  prompt: string;
  idealExplanation: string;
  nextReviewAt: string | Date;
  repetitions: number;
  lastReviewedAt: string | Date | null;
};

export function FlashcardList({ flashcards }: { flashcards: FlashcardListItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {flashcards.map((card) => {
        const due = new Date(card.nextReviewAt) <= new Date();
        const mastery = masteryOf(card.repetitions, card.lastReviewedAt);
        return (
          <li key={card.id} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-zinc-900">{card.prompt}</p>
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  className={clsx(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    MASTERY_CLASSES[mastery]
                  )}
                >
                  {MASTERY_LABEL[mastery]}
                </span>
                <Badge tone={due ? "amber" : "neutral"}>
                  {due ? "Due now" : `Due ${new Date(card.nextReviewAt).toLocaleDateString()}`}
                </Badge>
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">{card.idealExplanation}</p>
          </li>
        );
      })}
    </ul>
  );
}
