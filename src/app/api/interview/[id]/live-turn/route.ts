import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMStream } from "@/lib/llm";
import { courseGrounding } from "@/lib/course-grounding";
import { MAX_INTERVIEW_QUESTIONS, recallRawFor, type InterviewContext, type QAPair } from "@/lib/interview";
import { INTERVIEW_MODEL, generateNextQuestion, gradeAnswer } from "@/lib/interview-grade";
import {
  liveGradeSchema,
  liveTurnSchema,
  nextTurnKind,
  questionsAnswered,
  readLiveFeedback,
  toLiveFeedback,
  type LiveFeedback,
  type LiveNextTurn,
  type LiveTurnEvent,
} from "@/lib/live-interview";
import { createTrailerFilter, normalizeSpoken, parseGradeTrailer, questionFromSpoken } from "@/lib/live-text";
import { claimLiveSession, releaseLiveSession } from "@/lib/live-claim";
import { buildLiveTurnUserPrompt, liveSystemPrompt } from "@/lib/prompts/live";
import { writeRecallSafely } from "@/lib/recall-log";

/** Chunks one worked example is taken from. Fewer than a debate's: one reply, one example. */
const GROUNDING_K = 4;

/**
 * One spoken turn: saves the answer, streams the tutor's reply sentence by
 * sentence, then stores the reply, its grade, the recall event and the next
 * question. A turn counts as done once its feedback is stored; a failed reply
 * leaves feedback empty, so posting the same turn again regenerates it, and
 * posting a turn that is already done replays the stored reply.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(liveTurnSchema, body);
  if ("error" in result) return result.error;
  const { turnId, answer, transcriptSource } = result.data;

  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      page: { include: { notes: true, transcript: true } },
      topic: { select: { id: true, title: true, folderId: true } },
    },
  });
  if (!session) return jsonError("Interview session not found", 404);
  if (session.mode === "DEBATE") return jsonError("A debate is spoken through the debate routes", 422);
  const mode = session.mode;

  const turn = session.turns.find((t) => t.id === turnId);
  if (!turn) return jsonError("Question not found in this session", 404);
  if (turn.feedback !== null) {
    // The reply was saved but its stream never reached the client: Try again replays it.
    const stored = readLiveFeedback(turn.feedback);
    if (!stored) return jsonError("This question has already been answered", 422);
    return ndjson([
      { type: "text", delta: turn.spoken ?? "" },
      { type: "done", verdict: stored.verdict, ...(await replayState(id)) },
    ]);
  }
  if (session.status === "COMPLETED") return jsonError("This interview is already finished", 422);
  if (!(await claimLiveSession(id))) return jsonError("Still working on the last reply — give it a moment.", 409);

  const context: InterviewContext = {
    title: session.title,
    source: session.source,
    notesMarkdown: session.page?.notes?.markdown ?? null,
    transcriptText: session.page?.transcript?.rawText ?? null,
    topicText: session.topicText ?? session.topic?.title ?? null,
  };
  const earlier = session.turns.filter((t) => t.id !== turn.id);
  const history: QAPair[] = earlier
    .filter((t) => t.answer !== null)
    .map((t) => ({ question: t.question, answer: t.answer as string }));
  const answeringRetry = turn.retryOf !== null;
  const lastQuestion = questionsAnswered(earlier) + (answeringRetry ? 0 : 1) >= MAX_INTERVIEW_QUESTIONS;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: LiveTurnEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The tab went away mid-reply. Keep going so the turn is still saved.
        }
      };
      const fail = (message: string) => send({ type: "error", message });

      try {
        // The answer lands before the reply: what the student said is kept whether or not the model answers.
        // A regenerated reply must not inherit where an earlier one was cut off.
        await db.interviewTurn.update({ where: { id: turn.id }, data: { answer, interruptedAt: null } });
        const grounding = session.topic
          ? await courseGrounding(session.topic.folderId, `${session.topic.title}: ${turn.question}`, GROUNDING_K, "live-turn")
          : [];

        const filter = createTrailerFilter();
        try {
          for await (const delta of callLLMStream({
            model: INTERVIEW_MODEL,
            messages: [
              { role: "system", content: liveSystemPrompt(mode) },
              {
                role: "user",
                content: buildLiveTurnUserPrompt({
                  mode,
                  context,
                  history,
                  question: turn.question,
                  answer,
                  answeringRetry,
                  lastQuestion,
                  grounding,
                }),
              },
            ],
          })) {
            const text = filter.push(delta);
            if (text) send({ type: "text", delta: text });
          }
        } catch (e) {
          return fail(e instanceof Error ? e.message : "The tutor stopped mid-reply");
        }

        const { rest, spoken: raw, trailer } = filter.finish();
        if (rest) send({ type: "text", delta: rest });
        let spoken = normalizeSpoken(raw);

        let feedback: LiveFeedback;
        let nextQuestion: string | null;
        const grade = liveGradeSchema(mode).safeParse(parseGradeTrailer(trailer));
        if (grade.success) {
          const { nextQuestion: asked, ...graded } = grade.data;
          feedback = graded;
          nextQuestion = asked;
        } else {
          try {
            const graded = await gradeAnswer({
              mode,
              context,
              question: turn.question,
              answer,
              priorAnswers: history.map((h) => h.answer),
            });
            feedback = toLiveFeedback(graded.feedback);
            nextQuestion = questionFromSpoken(spoken);
          } catch {
            return fail("Your answer was kept, but it couldn't be graded. Try again.");
          }
        }
        feedback = { ...feedback, transcriptSource };

        const kind = nextTurnKind(feedback.verdict, answeringRetry);
        const finished = kind === "new" && lastQuestion;
        if (!finished && !nextQuestion) {
          // The reply ended without a question: ask one the typed way and say it.
          try {
            nextQuestion = await generateNextQuestion({
              mode,
              context,
              history: [...history, { question: turn.question, answer }],
            });
            send({ type: "text", delta: ` ${nextQuestion}` });
            spoken = normalizeSpoken(`${spoken} ${nextQuestion}`);
          } catch {
            // No question to ask: the session ends below.
          }
        }

        const saved = await db.interviewTurn.updateMany({
          where: { id: turn.id, feedback: null },
          data: { spoken, feedback: JSON.stringify(feedback) },
        });
        if (saved.count === 0) {
          // Another request finished this turn first; its recall and next turn stand.
          send({ type: "done", verdict: feedback.verdict, ...(await replayState(id)) });
          return;
        }
        await writeRecallSafely({
          raw: recallRawFor(mode, { score: feedback.score }),
          pageId: session.pageId,
          topicId: session.courseTopicId,
          misconception: feedback.improvement || null,
          detail: { question: turn.question, score: feedback.score, mode, live: true },
        });

        let nextTurn: LiveNextTurn | null = null;
        try {
          // The student may have pressed End while the reply was being written.
          const current = await db.interviewSession.findUnique({ where: { id }, select: { status: true } });
          if (current?.status === "COMPLETED") {
            nextTurn = null;
          } else if (!finished && nextQuestion) {
            const order = session.turns.reduce((max, t) => Math.max(max, t.order), turn.order) + 1;
            const created = await db.interviewTurn.create({
              data: {
                sessionId: session.id,
                order,
                question: nextQuestion,
                retryOf: kind === "retry" ? turn.id : null,
              },
            });
            nextTurn = { id: created.id, order: created.order, question: created.question, retryOf: created.retryOf };
          } else {
            await db.interviewSession.update({ where: { id: session.id }, data: { status: "COMPLETED" } });
          }
        } catch (e) {
          // The reply and its grade are already saved (feedback is non-null), so a
          // re-POST would only replay it. End the session here rather than leave it
          // stuck neither completed nor holding a next turn.
          console.error(`[live-turn] session ${id} failed to save the next turn:`, e);
          try {
            await db.interviewSession.update({ where: { id: session.id }, data: { status: "COMPLETED" } });
          } catch (e2) {
            console.error(`[live-turn] session ${id} failed to mark itself completed after a next-turn failure:`, e2);
          }
          nextTurn = null;
        }

        send({ type: "done", verdict: feedback.verdict, completed: nextTurn === null, nextTurn });
      } catch (e) {
        console.error(`[live-turn] session ${id} failed after the reply:`, e);
        fail("Something went wrong saving that turn. Try again.");
      } finally {
        // Released before the stream ends, so the client's next request never finds it held.
        await releaseLiveSession(id);
        try {
          controller.close();
        } catch {
          // The tab went away, so the stream is already gone. Nothing left to do.
        }
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

const NDJSON_HEADERS = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" };

function ndjson(events: LiveTurnEvent[]): Response {
  return new Response(events.map((e) => `${JSON.stringify(e)}\n`).join(""), { headers: NDJSON_HEADERS });
}

/** Where a session stands after its latest saved reply: finished, or waiting on its open question. */
async function replayState(id: string): Promise<{ completed: boolean; nextTurn: LiveNextTurn | null }> {
  const session = await db.interviewSession.findUnique({
    where: { id },
    select: { status: true, turns: { where: { speaker: null, feedback: null }, orderBy: { order: "desc" }, take: 1 } },
  });
  const completed = session?.status === "COMPLETED";
  const open = completed ? undefined : session?.turns[0];
  return {
    completed,
    nextTurn: open ? { id: open.id, order: open.order, question: open.question, retryOf: open.retryOf } : null,
  };
}
