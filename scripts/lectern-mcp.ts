/**
 * Lectern as an MCP server: the tools the study-plan agent runs with, and the
 * tools you get when you point your own Claude Code session at this repo.
 *
 * Two modes, chosen at startup by whether LECTERN_FOLDER_ID is set (see
 * src/lib/agent/mcp-scope.ts):
 *
 * - **Pinned.** How src/lib/agent/study-plan.ts spawns it, once per run. The
 *   course comes from the environment and is never a tool argument, so an
 *   unattended run that pre-approves `mcp__lectern__*` cannot read a course it
 *   was not pointed at.
 * - **Unpinned.** How .mcp.json spawns it for an interactive session. Every
 *   scoped tool takes a folderId and `list_courses` says what the ids are. The
 *   study-plan run is unaffected: args.ts passes --strict-mcp-config, so it
 *   never picks up .mcp.json.
 *
 * Run by hand:
 *   LECTERN_FOLDER_ID=<id> LECTERN_BASE_URL=http://127.0.0.1:3100 \
 *     claude --mcp-config '{"mcpServers":{"lectern":{"command":"node","args":["--import","tsx","scripts/lectern-mcp.ts"]}}}'
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { lecternFetch, truncate } from "../src/lib/agent/lectern-api.ts";
import { pinnedFolderId, resolveFolderId } from "../src/lib/agent/mcp-scope.ts";

let pinned: string | null;
try {
  pinned = pinnedFolderId();
} catch (e) {
  // stderr, not stdout: stdout is the MCP transport.
  console.error(`lectern-mcp: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
console.error(
  pinned === null
    ? "lectern-mcp: unpinned — every course is reachable, scoped per call by folderId"
    : `lectern-mcp: pinned to course ${pinned}`
);

/**
 * The folderId argument, declared only when unpinned. Spreading this into a
 * tool's inputSchema is what keeps a pinned server's schemas identical to
 * before: a pinned course must not be selectable by argument.
 *
 * The cast is load-bearing: without it the union of the two branches does not
 * satisfy the SDK's ZodRawShape. It declares the key optional because that is
 * the truth — pinned, it is absent at runtime — so a handler that reads
 * args.folderId directly gets `string | undefined` and has to face it.
 */
const scopeSchema = (
  pinned === null ? { folderId: z.string().min(1).describe("A courseId from list_courses") } : {}
) as { folderId?: z.ZodString };

const server = new McpServer({ name: "lectern", version: "1.0.0" });

/** Every tool returns text; a thrown error becomes an error result the agent can read and route around. */
function text(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
  };
}
function failure(e: unknown) {
  return {
    content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
    isError: true,
  };
}

// Unpinned only: a pinned server must keep the tool surface the study-plan
// agent was written against, and naming other courses is exactly what a pinned
// run may not do.
if (pinned === null) {
  server.registerTool(
    "list_courses",
    {
      description:
        "Every course, with the courseId that the other tools need and how many lectures each holds. Start here.",
      inputSchema: {},
    },
    async () => {
      try {
        const { folders } = await lecternFetch<{
          folders: { id: string; name: string; description: string | null; _count: { pages: number } }[];
        }>("/api/folders");
        if (folders.length === 0) return text("No courses yet.");
        return text(
          folders.map((f) => ({
            courseId: f.id,
            name: f.name,
            description: f.description,
            lectures: f._count.pages,
          }))
        );
      } catch (e) {
        return failure(e);
      }
    }
  );
}

server.registerTool(
  "list_lectures",
  {
    description:
      "Every lecture in this course: title, status, date, and how many flashcards and quiz questions it has. Start here.",
    inputSchema: { ...scopeSchema },
  },
  async (args) => {
    try {
      const folderId = resolveFolderId(pinned, args);
      const { pages } = await lecternFetch<{
        pages: {
          id: string;
          title: string;
          status: string;
          createdAt: string;
          _count: { flashcards: number; quizQuestions: number };
        }[];
      }>(`/api/pages?folderId=${encodeURIComponent(folderId)}`);
      return text(
        pages.map((p) => ({
          pageId: p.id,
          title: p.title,
          status: p.status,
          date: p.createdAt.slice(0, 10),
          flashcards: p._count.flashcards,
          quizQuestions: p._count.quizQuestions,
        }))
      );
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "get_lecture",
  {
    description:
      "One lecture's notes or raw transcript. Prefer notes; reach for the transcript only when the notes are missing or too thin to judge. Long text is truncated.",
    inputSchema: {
      ...scopeSchema,
      pageId: z.string().min(1).describe("A pageId from list_lectures"),
      part: z.enum(["notes", "transcript"]).describe("Which body of text to read"),
    },
  },
  async ({ pageId, part, ...scope }) => {
    try {
      const folderId = resolveFolderId(pinned, scope);
      const { page } = await lecternFetch<{
        page: {
          title: string;
          folder: { id: string };
          notes: { markdown: string } | null;
          transcript: { rawText: string; cleanText: string | null } | null;
        };
      }>(`/api/pages/${encodeURIComponent(pageId)}`);

      // The route has no folder check of its own, so the scope is enforced here.
      // Pinned, that is confinement: a pageId from another course reads as
      // not-found rather than leaking data. Unpinned, it degrades to a
      // consistency check that the pageId belongs to the course the caller named.
      if (page.folder.id !== folderId) return text("Not found in this course.");

      const body =
        part === "notes" ? page.notes?.markdown : (page.transcript?.cleanText ?? page.transcript?.rawText);
      if (!body) return text(`"${page.title}" has no ${part} yet.`);
      return text(`# ${page.title}\n\n${truncate(body)}`);
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "search_course",
  {
    description:
      "Semantic search over everything indexed for this course — lecture transcripts, notes, and materials. Use it to find where a topic is actually taught.",
    inputSchema: {
      ...scopeSchema,
      query: z.string().min(1).describe("What to look for, in the course's own words"),
      k: z.number().int().min(1).max(20).optional().describe("How many hits (default 8)"),
    },
  },
  async ({ query, k, ...scope }) => {
    try {
      const folderId = resolveFolderId(pinned, scope);
      const params = new URLSearchParams({ q: query, ...(k ? { k: String(k) } : {}) });
      const { hits } = await lecternFetch<{
        hits: { text: string; score: number; source: string; title: string; pageId: string | null }[];
      }>(`/api/folders/${encodeURIComponent(folderId)}/search?${params}`);
      if (hits.length === 0) return text("No indexed content matched that query.");
      return text(
        hits.map((h) => ({
          title: h.title,
          score: Number(h.score.toFixed(3)),
          source: h.source,
          pageId: h.pageId,
          text: truncate(h.text, 1200),
        }))
      );
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "topic_coverage",
  {
    description:
      "Every syllabus topic for this course and whether anything captured actually teaches it, with the closest match and its score. Scores are a heuristic — a topic marked uncovered may still be taught under different words, so check with search_course or get_lecture before calling a gap real.",
    inputSchema: { ...scopeSchema },
  },
  async (args) => {
    try {
      const folderId = resolveFolderId(pinned, args);
      const data = await lecternFetch<{
        coverage: "scored" | "no-sources" | "failed";
        topics: {
          title: string;
          week: number | null;
          covered: boolean;
          match: { title: string; score: number } | null;
        }[];
      }>(`/api/folders/${encodeURIComponent(folderId)}/coverage`);

      if (data.coverage === "no-sources") {
        return text(
          "No coverage verdict: this course has no syllabus topics, or nothing indexed to check them against."
        );
      }
      if (data.coverage === "failed") {
        return text("Coverage scoring failed for this course — treat every topic as unknown rather than uncovered.");
      }
      return text(data.topics);
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "review_load",
  {
    description: "Flashcards from this course that are due for review now, with the lecture each came from.",
    inputSchema: {
      ...scopeSchema,
      limit: z.number().int().min(1).max(100).optional().describe("Cap on cards listed (default 50)"),
    },
  },
  async ({ limit, ...scope }) => {
    try {
      const params = new URLSearchParams({ folderId: resolveFolderId(pinned, scope), limit: String(limit ?? 50) });
      const { cards, total } = await lecternFetch<{
        cards: { prompt: string; page: { title: string } | null; material: { title: string } | null }[];
        total: number;
      }>(`/api/review/due?${params}`);
      return text({
        totalDue: total,
        cards: cards.map((c) => ({ prompt: c.prompt, from: c.page?.title ?? c.material?.title ?? "Unknown" })),
      });
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "create_action_items",
  {
    description:
      "Record concrete next steps against one lecture, so they appear on that lecture's page. Use ACTION for something to do, QUESTION for something to ask, EXAM_HINT for a point the lecturer flagged as exam material. One call per lecture; keep each item to one sentence.",
    inputSchema: {
      ...scopeSchema,
      pageId: z.string().min(1).describe("The lecture the steps belong to"),
      items: z
        .array(
          z.object({
            kind: z.enum(["ACTION", "DECISION", "QUESTION", "EXAM_HINT"]),
            text: z.string().min(1).max(500),
          })
        )
        .min(1)
        .max(20),
    },
  },
  async ({ pageId, items, ...scope }) => {
    try {
      const folderId = resolveFolderId(pinned, scope);
      const { page } = await lecternFetch<{
        page: { folder: { id: string } };
      }>(`/api/pages/${encodeURIComponent(pageId)}`);

      // The route has no folder check of its own, so the scope is enforced here.
      // Pinned, that is confinement: a pageId from another course reads as
      // not-found rather than leaking data. Unpinned, it degrades to a
      // consistency check that the pageId belongs to the course the caller named.
      if (page.folder.id !== folderId) return text("Not found in this course.");

      const { items: saved } = await lecternFetch<{ items: unknown[] }>(
        `/api/pages/${encodeURIComponent(pageId)}/action-items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items }),
        }
      );
      return text(`Created ${items.length} item(s); this lecture now has ${saved.length}.`);
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "schedule_reviews",
  {
    description:
      "Put spaced-repetition review sessions on the student's real calendar — one event per upcoming day that already has cards due, over the next 7 days. You choose whether to schedule; the times come from the student's own settings. Omit pageId to schedule review sessions for cards due across all the student's courses, not just this one.",
    inputSchema: {
      // Unlike the other scoped tools, folderId is optional here: with no pageId
      // this schedules across every course, so there is no course to name.
      ...(pinned === null
        ? { folderId: z.string().min(1).optional().describe("The course the pageId belongs to; required with pageId") }
        : {}),
      pageId: z.string().min(1).optional().describe("Scope to one lecture's cards"),
    },
  },
  async ({ pageId, ...scope }) => {
    try {
      if (pageId) {
        const folderId = resolveFolderId(pinned, scope);
        const { page } = await lecternFetch<{
          page: { folder: { id: string } };
        }>(`/api/pages/${encodeURIComponent(pageId)}`);

        // The route has no folder check of its own, so the scope is enforced here.
        // Pinned, that is confinement: a pageId from another course reads as
        // not-found rather than leaking data. Unpinned, it degrades to a
        // consistency check that the pageId belongs to the course the caller named.
        if (page.folder.id !== folderId) return text("Not found in this course.");
      }

      const { createdDays } = await lecternFetch<{ createdDays: string[] }>(
        "/api/integrations/calendar/schedule-reviews",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pageId ? { pageId } : {}),
        }
      );
      return text(`Scheduled review sessions on: ${createdDays.join(", ")}`);
    } catch (e) {
      // No calendar MCP configured, or nothing due — both come back as the
      // route's own message, which is what the plan should say happened.
      return failure(e);
    }
  }
);

// Top-level await needs ESM output; this repo's package.json has no "type":
// "module", so tsx transforms .ts scripts to CJS (see scripts/reindex.ts's
// same avoidance). An async IIFE keeps the brief's connect call unchanged.
void (async () => {
  await server.connect(new StdioServerTransport());
})().catch((e) => {
  console.error("lectern-mcp: failed to connect:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
