import { ReviewSession } from "@/components/review/ReviewSession";

export default function ReviewPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Review</h1>
      <ReviewSession />
    </div>
  );
}
