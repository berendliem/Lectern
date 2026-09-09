import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON, reasoningModel } from "@/lib/llm";
import { searchCourse } from "@/lib/embeddings";
import {
  DEBATE_AGENTS,
  MAX_DEBATE_EXCHANGES,
  STUDENT_SPEAKER,
  canAdvance,
  nextOrder,
  nextSpeaker,
  pendingInterjection,
  type DebateTurn,
} from "@/lib/debate";
import { DEBATE_SYSTEM_PROMPT, buildDebateUtterancePrompt } from "@/lib/prompts/debate";
import { debateUtteranceResponseSchema } from "@/lib/validation";

/** How many course chunks ground one exchange. */
const GROUNDING_K = 6;

/**
 * One exchange: each agent speaks once, in order, both grounded in the same
 * retrieved chunks. Two completions per call on the free REASONING tier, capped
 * at six exchanges per session.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      topic: { select: { id: true, title: true, folderId: true } },
    },
  });
  if (!session) return jsonError("Interview session not found", 404);
  if (session.mode !== "DEBATE") return jsonError("This session is not a debate", 422);
  if (!session.topic) return jsonError("This debate has no course topic behind it", 422);

  const turns: DebateTurn[] = session.turns.map((t) => ({
    order: t.order,
    speaker: t.speaker,
    answer: t.answer,
  }));

  if (!canAdvance(turns)) {
    await db.interviewSession.update({ where: { id }, data: { status: "COMPLETED" } });
    return NextResponse.json({ turns: [], done: true, maxExchanges: MAX_DEBATE_EXCHANGES });
  }

  let grounding: { title: string; text: string }[] = [];
  try {
    const hits = await searchCourse(session.topic.folderId, session.topic.title, GROUNDING_K);
    grounding = hits.map((hit) => ({ title: hit.title, text: hit.text }));
  } catch (e) {
    console.error(
      `[debate/advance] semantic retrieval failed for debate session ${id}, continuing ungrounded:`,
      e
    );
  }

  const texts = new Map<number, string>(
    session.turns.map((t) => [t.order, t.speaker === STUDENT_SPEAKER ? (t.answer ?? "") : t.question])
  );

  const created = [];
  const working = [...turns];
  const pending = pendingInterjection(working);

  for (let i = 0; i < DEBATE_AGENTS.length; i++) {
    const speaker = nextSpeaker(working);
    const order = nextOrder(working);

    let utterance: string;
    try {
      const raw = await callLLMJSON({
        model: reasoningModel(),
        systemPrompt: DEBATE_SYSTEM_PROMPT,
        userPrompt: buildDebateUtterancePrompt({
          speaker,
          concept: session.topic.title,
          persona: session.persona,
          grounding,
          turns: working,
          texts,
          // Only the first agent of the round answers the interjection; the
          // second is answering the first, which is the whole point of a debate.
          pending: i === 0 ? pending : null,
        }),
      });
      utterance = (await debateUtteranceResponseSchema.parseAsync(raw)).utterance;
    } catch (e) {
      // Half an exchange is still a readable transcript, so keep what landed
      // rather than rolling the round back.
      if (created.length > 0) break;
      const message =
        e instanceof ZodError
          ? "The model's response didn't match the expected format. You can retry this step."
          : e instanceof Error
            ? e.message
            : "The debate could not continue";
      return jsonError(message, 502);
    }

    const turn = await db.interviewTurn.create({
      data: { sessionId: id, order, question: utterance, speaker },
    });
    created.push(turn);
    working.push({ order, speaker, answer: null });
    texts.set(order, utterance);
  }

  const done = !canAdvance(working);
  if (done) {
    await db.interviewSession.update({ where: { id }, data: { status: "COMPLETED" } });
  }

  return NextResponse.json({ turns: created, done, maxExchanges: MAX_DEBATE_EXCHANGES });
}
