// Pure helpers for the Study Planner. Kept free of DB/React so they can be
// reasoned about and unit-tested directly.

/** Local YYYY-MM-DD key for a date (planner "days" are local, not UTC). */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Current review streak: consecutive days (ending today, or yesterday if you
 * haven't reviewed yet today) on which at least one review happened.
 */
export function computeStreak(reviewedAt: Date[], now: Date = new Date()): number {
  const days = new Set(reviewedAt.map(dayKey));
  if (days.size === 0) return 0;

  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(dayKey(cursor))) {
    // Grace: today isn't over, so fall back to yesterday before giving up.
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export type UpcomingDay = { key: string; label: string; date: Date; count: number; isToday: boolean };

/**
 * Cards coming due over the next `days` days, bucketed per local day. Anything
 * due in the past (or now) folds into today's bucket, since it's due already.
 */
export function upcomingSchedule(nextReviewAts: Date[], days = 7, now: Date = new Date()): UpcomingDay[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets: UpcomingDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    buckets.push({
      key: dayKey(date),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : date.toLocaleDateString("en", { weekday: "short" }),
      date,
      count: 0,
      isToday: i === 0,
    });
  }
  const lastKey = buckets[buckets.length - 1].key;

  for (const at of nextReviewAts) {
    const k = at < today ? buckets[0].key : dayKey(at);
    const bucket = buckets.find((b) => b.key === k);
    if (bucket) bucket.count += 1;
    else if (dayKey(at) <= lastKey) buckets[0].count += 1;
  }
  return buckets;
}
