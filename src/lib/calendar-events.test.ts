import { test } from "node:test";
import assert from "node:assert/strict";
import {
  externalKeyFor,
  parseEventStart,
  isAcademic,
  inRecordWindow,
  examCountdown,
  dayLabel,
  groupByDay,
  masteryByFolder,
  isStale,
  STALE_AFTER_MS,
} from "./calendar-events.ts";

const now = new Date(2026, 8, 11, 12, 0, 0); // local Fri 11 Sep 2026 12:00

test("externalKeyFor is stable for the same title and start", () => {
  assert.equal(externalKeyFor("Midterm", "2026-09-15T13:00"), externalKeyFor("Midterm", "2026-09-15T13:00"));
  assert.notEqual(externalKeyFor("Midterm", "2026-09-15T13:00"), externalKeyFor("Midterm", "2026-09-16T13:00"));
  assert.match(externalKeyFor("a", "b"), /^[0-9a-f]{40}$/);
});

test("parseEventStart reads a local date-time", () => {
  const parsed = parseEventStart("2026-09-15T13:05");
  assert.ok(parsed);
  assert.equal(parsed.allDay, false);
  assert.equal(parsed.start.getFullYear(), 2026);
  assert.equal(parsed.start.getMonth(), 8);
  assert.equal(parsed.start.getDate(), 15);
  assert.equal(parsed.start.getHours(), 13);
  assert.equal(parsed.start.getMinutes(), 5);
});

test("parseEventStart reads an all-day date as local midnight", () => {
  const parsed = parseEventStart("2026-09-15");
  assert.ok(parsed);
  assert.equal(parsed.allDay, true);
  assert.equal(parsed.start.getHours(), 0);
  assert.equal(parsed.start.getDate(), 15);
});

test("parseEventStart rejects junk", () => {
  assert.equal(parseEventStart("tomorrow"), null);
  assert.equal(parseEventStart(""), null);
  assert.equal(parseEventStart("2026-13-40"), null);
});

test("isAcademic is true for a kind or a course, false for an untied OTHER", () => {
  assert.equal(isAcademic({ kind: "EXAM", folderId: null }), true);
  assert.equal(isAcademic({ kind: "OTHER", folderId: "f1" }), true);
  assert.equal(isAcademic({ kind: "OTHER", folderId: null }), false);
});

test("inRecordWindow opens 15 minutes before and closes 30 minutes after", () => {
  const start = new Date(2026, 8, 11, 14, 0);
  assert.equal(inRecordWindow(start, new Date(2026, 8, 11, 13, 44)), false);
  assert.equal(inRecordWindow(start, new Date(2026, 8, 11, 13, 45)), true);
  assert.equal(inRecordWindow(start, new Date(2026, 8, 11, 14, 30)), true);
  assert.equal(inRecordWindow(start, new Date(2026, 8, 11, 14, 31)), false);
});

test("examCountdown speaks in days", () => {
  assert.equal(examCountdown(new Date(2026, 8, 11, 18, 0), now), "Today");
  assert.equal(examCountdown(new Date(2026, 8, 12, 9, 0), now), "Tomorrow");
  assert.equal(examCountdown(new Date(2026, 8, 15, 13, 0), now), "in 4 days");
});

test("dayLabel is Today, Tomorrow, then weekday and day", () => {
  assert.equal(dayLabel(new Date(2026, 8, 11, 9), now), "Today");
  assert.equal(dayLabel(new Date(2026, 8, 12, 9), now), "Tomorrow");
  assert.equal(dayLabel(new Date(2026, 8, 15, 9), now), "Tue 15");
});

test("groupByDay keeps order and groups by local day", () => {
  const a = { id: "a", start: new Date(2026, 8, 11, 14) };
  const b = { id: "b", start: new Date(2026, 8, 11, 16) };
  const c = { id: "c", start: new Date(2026, 8, 12, 9) };
  const groups = groupByDay([a, b, c], now);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "Today");
  assert.deepEqual(groups[0].events.map((e) => e.id), ["a", "b"]);
  assert.equal(groups[1].label, "Tomorrow");
  assert.deepEqual(groups[1].events.map((e) => e.id), ["c"]);
});

test("masteryByFolder counts total, mastered, and due per course and skips unfiled cards", () => {
  const past = new Date(now.getTime() - 1000);
  const future = new Date(now.getTime() + 86_400_000);
  const stats = masteryByFolder(
    [
      { repetitions: 3, lastReviewedAt: past, nextReviewAt: future, folderId: "f1" },
      { repetitions: 0, lastReviewedAt: null, nextReviewAt: past, folderId: "f1" },
      { repetitions: 1, lastReviewedAt: past, nextReviewAt: past, folderId: "f2" },
      { repetitions: 5, lastReviewedAt: past, nextReviewAt: future, folderId: null },
    ],
    now
  );
  assert.deepEqual(stats.get("f1"), { total: 2, mastered: 1, due: 1 });
  assert.deepEqual(stats.get("f2"), { total: 1, mastered: 0, due: 1 });
  assert.equal(stats.size, 2);
});

test("isStale is true with no sync, or a sync older than the threshold", () => {
  assert.equal(isStale(null, now), true);
  assert.equal(isStale(new Date(now.getTime() - STALE_AFTER_MS - 1), now), true);
  assert.equal(isStale(new Date(now.getTime() - STALE_AFTER_MS + 1000), now), false);
});
