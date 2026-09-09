import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { runStudyPlan } from "@/lib/agent/study-plan";

export const runtime = "nodejs";
// The run is minutes long by design; it must not be buffered or retried.
export const dynamic = "force-dynamic";

// Streams the agent's events as newline-delimited JSON, so the panel can show
// tool calls as they happen instead of a spinner over a minute of silence.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const folder = await db.folder.findUnique({ where: { id }, select: { name: true } });
  if (!folder) return jsonError("Course not found", 404);

  const topics = await db.courseTopic.findMany({
    where: { folderId: id },
    orderBy: { order: "asc" },
    select: { title: true },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runStudyPlan({
          folderId: id,
          courseName: folder.name,
          topics: topics.map((t: { title: string }) => t.title),
          // The user closing the panel kills the process tree, rather than
          // leaving `claude` holding an MCP server holding a socket.
          signal: req.signal,
        })) {
          send(event);
        }
      } catch (e) {
        // The response is already 200 by the time this can happen, so the
        // error travels as an event and the panel renders it.
        send({ type: "error", message: e instanceof Error ? e.message : "The study-plan run failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
