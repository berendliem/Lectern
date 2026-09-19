// Debate turn algebra. Pure: the routes own the completions and the database,
// this owns who speaks next and when to stop. Split the same way recall.ts is
// split from recall-log.ts, and for the same reason — the arithmetic is the part
// worth pinning with tests.

/**
 * The two personas. Two, not three: a third voice triples the cost per exchange
 * and adds no distinction a student cannot already see.
 */
export const DEBATE_AGENTS = ["Proponent", "Skeptic"] as const;

/** The `speaker` value on a turn the student wrote. */
export const STUDENT_SPEAKER = "You";

/**
 * One exchange is one utterance from each agent.
 * ponytail: six is a context-window guess for free models, not a pedagogical one.
 */
export const MAX_DEBATE_EXCHANGES = 6;

export type DebateTurn = {
  order: number;
  speaker: string | null;
  answer: string | null;
};

function isAgent(turn: DebateTurn): boolean {
  return turn.speaker !== null && turn.speaker !== STUDENT_SPEAKER;
}

/** Completed rounds. A half-finished round does not count. */
export function exchangeCount(turns: DebateTurn[]): number {
  return Math.floor(turns.filter(isAgent).length / DEBATE_AGENTS.length);
}

export function canAdvance(turns: DebateTurn[]): boolean {
  return exchangeCount(turns) < MAX_DEBATE_EXCHANGES;
}

export function nextOrder(turns: DebateTurn[]): number {
  return turns.reduce((max, t) => Math.max(max, t.order), -1) + 1;
}

/** Agents alternate by their own count, so an interjection never costs one of them a turn. */
export function nextSpeaker(turns: DebateTurn[]): string {
  return DEBATE_AGENTS[turns.filter(isAgent).length % DEBATE_AGENTS.length];
}

/**
 * The interjection the agents have not yet spoken after. The student may
 * interject twice in a row; only the newest is owed a response, because the
 * older one is already in the transcript the next prompt sends.
 */
export function pendingInterjection(turns: DebateTurn[]): DebateTurn | null {
  const sorted = [...turns].sort((a, b) => a.order - b.order);
  const lastAgentOrder = sorted.filter(isAgent).reduce((max, t) => Math.max(max, t.order), -1);
  const after = sorted.filter((t) => t.speaker === STUDENT_SPEAKER && t.order > lastAgentOrder);
  return after.length > 0 ? after[after.length - 1] : null;
}

/** A turn as Prisma returns it, narrowed to what the debate algebra and prompts read. */
export type StoredDebateTurn = { order: number; speaker: string | null; question: string; answer: string | null };

export function toDebateTurns(turns: StoredDebateTurn[]): DebateTurn[] {
  return turns.map((t) => ({ order: t.order, speaker: t.speaker, answer: t.answer }));
}

/** What each turn said: an agent's utterance lives in `question`, the student's point in `answer`. */
export function debateTexts(turns: StoredDebateTurn[]): Map<number, string> {
  return new Map(turns.map((t) => [t.order, t.speaker === STUDENT_SPEAKER ? (t.answer ?? "") : t.question]));
}
