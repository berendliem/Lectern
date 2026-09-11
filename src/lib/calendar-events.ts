/**
 * Pure helpers for calendar events on home and the planner. No db, no env, so
 * `node --test` imports it directly — the same split as embed-math.ts.
 */
import { createHash } from "node:crypto";
import { dayKey } from "./planner.ts";
import { masteryOf } from "./mastery.ts";

export type CalendarEventKind = "EXAM" | "ASSIGNMENT" | "CLASS" | "OTHER";
export const CALENDAR_EVENT_KINDS: readonly CalendarEventKind[] = ["EXAM", "ASSIGNMENT", "CLASS", "OTHER"];

/** How far ahead a sync reads. The planner shows all of it. */
export const SYNC_WINDOW_DAYS = 14;
/** How far ahead home's Up next looks. */
export const HOME_WINDOW_DAYS = 7;
/** A sync older than this triggers one background refresh on home. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const RECORD_BEFORE_MS = 15 * 60 * 1000;
const RECORD_AFTER_MS = 30 * 60 * 1000;

/** The MCP listing carries no event id, so identity is title plus start. */
export function externalKeyFor(title: string, start: string): string {
  return createHash("sha1").update(`${title}\n${start}`).digest("hex");
}

/**
 * The parse prompt normalizes to "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD". Both are
 * read as local time: `new Date("2026-09-15")` alone would be UTC midnight and
 * land an all-day exam on the wrong day west of Greenwich.
 */
export function parseEventStart(value: string): { start: Date; allDay: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const allDay = h === undefined;
  const start = new Date(Number(y), Number(mo) - 1, Number(d), allDay ? 0 : Number(h), allDay ? 0 : Number(mi));
  if (Number.isNaN(start.getTime())) return null;
  // Date rolls "2026-13-40" forward instead of failing; compare back.
  if (start.getMonth() !== Number(mo) - 1 || start.getDate() !== Number(d)) return null;
  return { start, allDay };
}

/** Home shows an event only when it is a course's or has an academic kind. */
export function isAcademic(e: { kind: CalendarEventKind; folderId: string | null }): boolean {
  return e.kind !== "OTHER" || e.folderId !== null;
}

/** A class is recordable from 15 minutes before its start to 30 minutes after. */
export function inRecordWindow(start: Date, now: Date): boolean {
  const delta = start.getTime() - now.getTime();
  return delta <= RECORD_BEFORE_MS && delta >= -RECORD_AFTER_MS;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

export function examCountdown(start: Date, now: Date): string {
  const days = daysBetween(now, start);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

export function dayLabel(date: Date, now: Date): string {
  const days = daysBetween(now, date);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const weekday = date.toLocaleDateString("en", { weekday: "short" });
  return `${weekday} ${date.getDate()}`;
}

export function groupByDay<T extends { start: Date }>(
  events: T[],
  now: Date
): { key: string; label: string; events: T[] }[] {
  const groups: { key: string; label: string; events: T[] }[] = [];
  for (const e of events) {
    const key = dayKey(e.start);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, label: dayLabel(e.start, now), events: [e] });
  }
  return groups;
}

export type FolderCardStats = { total: number; mastered: number; due: number };

/** One pass over every card; cards with no course are not home's business. */
export function masteryByFolder(
  cards: { repetitions: number; lastReviewedAt: Date | null; nextReviewAt: Date; folderId: string | null }[],
  now: Date
): Map<string, FolderCardStats> {
  const out = new Map<string, FolderCardStats>();
  for (const c of cards) {
    if (!c.folderId) continue;
    const s = out.get(c.folderId) ?? { total: 0, mastered: 0, due: 0 };
    s.total += 1;
    if (masteryOf(c.repetitions, c.lastReviewedAt) === "mastered") s.mastered += 1;
    if (c.nextReviewAt.getTime() <= now.getTime()) s.due += 1;
    out.set(c.folderId, s);
  }
  return out;
}

export function isStale(lastSyncedAt: Date | null, now: Date): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - lastSyncedAt.getTime() > STALE_AFTER_MS;
}
