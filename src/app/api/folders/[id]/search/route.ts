import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { searchCourse } from "@/lib/embeddings";

export const runtime = "nodejs";

const DEFAULT_K = 8;
const MAX_K = 20;

// Semantic search over one course's chunks, as hits rather than prose.
// `/api/folders/[id]/ask` runs the same retrieval but spends an LLM call
// turning it into an answer; the agent wants the hits themselves.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ hits: [] });

  const raw = Number(req.nextUrl.searchParams.get("k") ?? DEFAULT_K);
  const k = Number.isFinite(raw) ? Math.min(MAX_K, Math.max(1, Math.trunc(raw))) : DEFAULT_K;

  try {
    return NextResponse.json({ hits: await searchCourse(id, q, k) });
  } catch (e) {
    // Embedding failures are the realistic case here (model not downloaded,
    // provider unreachable) — report them rather than returning empty hits,
    // which would read as "this course covers nothing".
    return jsonError(e instanceof Error ? e.message : "Course search failed", 502);
  }
}
