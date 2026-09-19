import { db } from "@/lib/db";

/**
 * Longer than the LLM timeout (120s in openrouter.ts), so a claim only goes
 * stale when the server died mid-reply without releasing it.
 */
const CLAIM_STALE_MS = 150_000;

/**
 * One live reply per session at a time: a double-submit or a retry that races
 * a still-running reply would otherwise grade and create the next turn twice.
 * Atomic because the check and the write are one UPDATE.
 */
export async function claimLiveSession(id: string): Promise<boolean> {
  const { count } = await db.interviewSession.updateMany({
    where: {
      id,
      status: "ACTIVE",
      OR: [{ liveClaimedAt: null }, { liveClaimedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } }],
    },
    data: { liveClaimedAt: new Date() },
  });
  return count > 0;
}

export async function releaseLiveSession(id: string): Promise<void> {
  try {
    await db.interviewSession.update({ where: { id }, data: { liveClaimedAt: null } });
  } catch (e) {
    // A stuck claim expires on its own; the reply itself is already saved.
    console.error(`[live-claim] session ${id} could not release its claim:`, e);
  }
}
