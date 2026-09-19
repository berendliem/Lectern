import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMStream, reasoningModel } from "@/lib/llm";
import { courseGrounding } from "@/lib/course-grounding";
import {
  canAdvance,
  debateTexts,
  nextOrder,
  nextSpeaker,
  pendingInterjection,
  toDebateTurns,
} from "@/lib/debate";
import { readLiveFeedback, type DebateLiveEvent } from "@/lib/live-interview";
import { normalizeSpoken } from "@/lib/live-text";
import { DEBATE_LIVE_SYSTEM_PROMPT, buildDebateUtterancePrompt } from "@/lib/prompts/debate";

const GROUNDING_K = 6;

/**
 * One agent's utterance, streamed for the voice. One per request rather than
 * a whole exchange: when the student cuts in, the next agent has not been
 * generated yet, so it can answer the interjection instead of an argument the
 * student never heard.
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
  if (session.status !== "ACTIVE") return jsonError("This debate is already finished", 422);
  if (!session.topic) return jsonError("This debate has no course topic behind it", 422);
  const topic = session.topic;

  const turns = toDebateTurns(session.turns);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: DebateLiveEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The tab went away. Keep going so the utterance is still saved.
        }
      };

      try {
        if (!canAdvance(turns)) {
          await db.interviewSession.update({ where: { id }, data: { status: "COMPLETED" } });
          send({ type: "done", turn: null, finished: true });
          controller.close();
          return;
        }

        const grounding = await courseGrounding(topic.folderId, topic.title, GROUNDING_K, "debate/live");
        const pending = pendingInterjection(turns);
        const pendingRow = pending ? session.turns.find((t) => t.order === pending.order) : undefined;
        const pendingFeedback = readLiveFeedback(pendingRow?.feedback ?? null);
        const speaker = nextSpeaker(turns);
        const order = nextOrder(turns);
        send({ type: "speaker", speaker, order });

        let text = "";
        try {
          for await (const delta of callLLMStream({
            model: reasoningModel(),
            messages: [
              { role: "system", content: DEBATE_LIVE_SYSTEM_PROMPT },
              {
                role: "user",
                content: buildDebateUtterancePrompt({
                  speaker,
                  concept: topic.title,
                  persona: session.persona,
                  grounding,
                  turns,
                  texts: debateTexts(session.turns),
                  pending,
                  live: {
                    pendingGrade: pendingFeedback
                      ? { verdict: pendingFeedback.verdict, correction: pendingFeedback.correction }
                      : null,
                  },
                }),
              },
            ],
          })) {
            text += delta;
            send({ type: "text", delta });
          }
        } catch (e) {
          send({ type: "error", message: e instanceof Error ? e.message : "The debate could not continue" });
          controller.close();
          return;
        }

        const utterance = normalizeSpoken(text);
        if (!utterance) {
          send({ type: "error", message: "The debater had nothing to say. Try again." });
          controller.close();
          return;
        }

        const created = await db.interviewTurn.create({
          data: { sessionId: id, order, question: utterance, speaker },
        });
        const finished = !canAdvance([...turns, { order, speaker, answer: null }]);
        if (finished) await db.interviewSession.update({ where: { id }, data: { status: "COMPLETED" } });

        send({
          type: "done",
          turn: { id: created.id, order: created.order, speaker, question: created.question },
          finished,
        });
        controller.close();
      } catch (e) {
        console.error(`[debate/live] session ${id} failed:`, e);
        send({ type: "error", message: "Something went wrong saving that turn. Try again." });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
