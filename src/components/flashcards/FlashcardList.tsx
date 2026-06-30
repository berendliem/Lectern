import { Badge } from "@/components/ui/Badge";

export type FlashcardListItem = {
  id: string;
  prompt: string;
  idealExplanation: string;
  nextReviewAt: string | Date;
  repetitions: number;
};

export function FlashcardList({ flashcards }: { flashcards: FlashcardListItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {flashcards.map((card) => {
        const due = new Date(card.nextReviewAt) <= new Date();
        return (
          <li key={card.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{card.prompt}</p>
              <Badge tone={due ? "amber" : "neutral"} className="shrink-0">
                {due ? "Due now" : `Due ${new Date(card.nextReviewAt).toLocaleDateString()}`}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">{card.idealExplanation}</p>
          </li>
        );
      })}
    </ul>
  );
}
