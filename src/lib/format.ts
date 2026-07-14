const SHORT_DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const SHORT_DATE_YEAR = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

export function shortDate(value: string | Date): string {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return (sameYear ? SHORT_DATE : SHORT_DATE_YEAR).format(date);
}
