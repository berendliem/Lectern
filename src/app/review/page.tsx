import { ReviewSession } from "@/components/review/ReviewSession";

export default function ReviewPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Review</h1>
        <p className="mt-0.5 text-[13px] text-zinc-400">Spaced repetition keeps what you learned from fading.</p>
      </div>
      <ReviewSession />
    </div>
  );
}
