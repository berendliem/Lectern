const SHORT_DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const SHORT_DATE_YEAR = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

export function shortDate(value: string | Date): string {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return (sameYear ? SHORT_DATE : SHORT_DATE_YEAR).format(date);
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
