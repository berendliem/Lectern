/**
 * The single writer to the recall ledger. Every grader — flashcards, quiz,
 * Feynman, interview, blurt — calls `writeRecall`, and nothing else touches
 * `db.reviewLog`. That is the only thing keeping the channels comparable: a
 * grader writing the row itself would be a grader writing its own scale.
 *
 * The scale arithmetic is in `recall.ts`, which stays pure and tested.
 */

import { db } from "./db";
import { assertSingleParent } from "./cards";
import {
  RECALL_LEDGER_SINCE,
  RESOLVE_QUALITY,
  PASS_QUALITY,
  isSchedulable,
  normalizeQuality,
  type RecallRaw,
} from "./recall";

/**
 * How many failed recalls of one target it takes to earn a card built from the
 * misconception itself.
 * ponytail: three strikes is a guess; it is a threshold, so it is a knob.
 */
const STRIKES_FOR_CARD = 3;

/**
 * A diagnosis is one line. Capping here rather than in each grader's schema is
 * what makes it true of all four: the text arrives from a model that has just
 * read lecture notes it does not control, and it ends up in a flashcard.
 */
const MAX_MISCONCEPTION_CHARS = 1000;

function oneLine(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_MISCONCEPTION_CHARS
    ? `${trimmed.slice(0, MAX_MISCONCEPTION_CHARS - 1)}…`
    : trimmed;
}

/**
 * What the event is about. All are optional — a Feynman attempt on a typed
 * concept has no parent at all, and the event still counts.
 */
export type RecallTarget = {
  flashcardId?: string | null;
  pageId?: string | null;
  materialId?: string | null;
  topicId?: string | null;
};

export type RecallEvent = RecallTarget & {
  raw: RecallRaw;
  /** 0-3 from the pre-reveal control; null when the student skipped it. */
  confidence?: number | null;
  /** One-line diagnosis, stored only when the recall failed. */
  misconception?: string | null;
  /** The grader's own payload, serialized as JSON. */
  detail?: unknown;
};

export type RecallResult = {
  quality: number;
  /** False for pretests, which are recorded and never fed to a scheduler. */
  schedulable: boolean;
};

/** The columns that identify what a misconception is open *about*. */
function targetFilter(event: RecallTarget) {
  const clauses = [];
  if (event.flashcardId) clauses.push({ flashcardId: event.flashcardId });
  if (event.pageId) clauses.push({ pageId: event.pageId });
  if (event.materialId) clauses.push({ materialId: event.materialId });
  if (event.topicId) clauses.push({ topicId: event.topicId });
  return clauses.length > 0 ? { OR: clauses } : null;
}

/**
 * The row itself, so a caller that must write inside its own transaction (the
 * blurt route writes its cards and its event together) still gets the columns
 * filled by this module rather than by hand.
 */
export function recallRow(event: RecallEvent) {
  const quality = normalizeQuality(event.raw);
  return {
    kind: event.raw.kind,
    quality,
    confidence: event.confidence ?? null,
    flashcardId: event.flashcardId ?? null,
    pageId: event.pageId ?? null,
    materialId: event.materialId ?? null,
    topicId: event.topicId ?? null,
    // A diagnosis only means something against a failed attempt; storing one
    // on a pass would leave the misconception list arguing with the grade.
    misconception: quality < PASS_QUALITY ? oneLine(event.misconception) : null,
    detail: event.detail === undefined ? null : JSON.stringify(event.detail),
  };
}

/**
 * The pass that runs after the row lands: a good recall closes what earlier
 * failures opened, a failed one counts toward a card. Exported for the same
 * reason as `recallRow` — a caller that wrote the row in its own transaction
 * still owes the ledger this.
 */
export async function settleMisconceptions(event: RecallEvent): Promise<RecallResult> {
  const quality = normalizeQuality(event.raw);
  const schedulable = isSchedulable(event.raw.kind);
  const scope = targetFilter(event);

  // A pretest is a guess about unseen material. Neither closing nor opening a
  // misconception on it says anything true about what the student knows.
  if (scope && schedulable) {
    if (quality >= RESOLVE_QUALITY) await closeMisconceptions(scope);
    else if (quality < PASS_QUALITY && event.misconception) {
      await maybeCardFromMisconception(event, scope);
    }
  }

  return { quality, schedulable };
}

export async function writeRecall(event: RecallEvent): Promise<RecallResult> {
  await db.reviewLog.create({ data: recallRow(event) });
  return settleMisconceptions(event);
}

/**
 * Like `indexSourceSafely`: a student who answered a question has answered it,
 * whatever the bookkeeping did. Graders use this so a ledger failure cannot
 * turn into a 500 on a graded answer.
 */
export async function writeRecallSafely(event: RecallEvent): Promise<RecallResult | null> {
  try {
    return await writeRecall(event);
  } catch (e) {
    console.error(`[recall] writing a ${event.raw.kind} event failed:`, e);
    return null;
  }
}

type Scope = NonNullable<ReturnType<typeof targetFilter>>;

/** A later success on the same target closes what earlier failures opened. */
async function closeMisconceptions(scope: Scope): Promise<void> {
  await db.reviewLog.updateMany({
    where: { ...scope, resolvedAt: null, misconception: { not: null } },
    data: { resolvedAt: new Date() },
  });
}

/**
 * Three open misconceptions on one target buy one flashcard built from the
 * latest correction — the cheapest possible card, since the text was already
 * written by whichever grader diagnosed the failure.
 */
async function maybeCardFromMisconception(event: RecallEvent, scope: Scope): Promise<void> {
  const parent = event.pageId
    ? { pageId: event.pageId }
    : event.materialId
      ? { materialId: event.materialId }
      : null;
  // A card must hang from exactly one lecture or material (see cards.ts). An
  // event with neither still logs its misconception; it just cannot buy a card.
  if (!parent) return;

  const correction = oneLine(event.misconception);
  if (!correction) return;

  // Strikes on *this* diagnosis, not on the lecture. Counting every failure on
  // the page would build the card from whichever mistake happened to be third,
  // and call it a thing the student missed three times when they missed three
  // different things once each.
  const strikes = await db.reviewLog.count({
    where: {
      ...scope,
      resolvedAt: null,
      misconception: correction,
      quality: { lt: PASS_QUALITY },
      reviewedAt: { gte: RECALL_LEDGER_SINCE },
    },
  });
  if (strikes < STRIKES_FOR_CARD) return;

  // Dedupe on the explanation alone: a blurt already writes its corrections as
  // cards under its own sourceTerm, and a second card carrying the same text
  // under a different label is still a duplicate.
  const existing = await db.flashcard.findFirst({
    where: { ...parent, idealExplanation: correction },
    select: { id: true },
  });
  if (existing) return;

  const sourceTerm = `Missed ${strikes}×`;

  await db.flashcard.create({
    data: {
      ...assertSingleParent(parent),
      prompt: `You have missed this ${strikes} times. Explain it in your own words: ${correction}`,
      idealExplanation: correction,
      sourceTerm,
    },
  });
}
