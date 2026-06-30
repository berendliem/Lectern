import { Button } from "@/components/ui/Button";

const GRADES: { label: string; quality: number; variant: "secondary" | "danger" | "primary" }[] = [
  { label: "Again", quality: 0, variant: "danger" },
  { label: "Hard", quality: 3, variant: "secondary" },
  { label: "Good", quality: 4, variant: "primary" },
  { label: "Easy", quality: 5, variant: "primary" },
];

export function ReviewGradeButtons({ onGrade }: { onGrade: (quality: number) => void }) {
  return (
    <div className="flex justify-center gap-2">
      {GRADES.map((g) => (
        <Button key={g.label} variant={g.variant} onClick={() => onGrade(g.quality)}>
          {g.label}
        </Button>
      ))}
    </div>
  );
}
