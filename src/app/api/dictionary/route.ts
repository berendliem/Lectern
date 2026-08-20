import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { createDictionaryTermSchema } from "@/lib/validation";

// Only the newest 50 terms are used for biasing anyway; a hard row cap keeps
// the table (and the /dictionary page) from growing without bound.
const MAX_TERMS = 500;

export async function GET() {
  const terms = await db.dictionaryTerm.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ terms });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(createDictionaryTermSchema, body);
  if ("error" in result) return result.error;

  const count = await db.dictionaryTerm.count();
  if (count >= MAX_TERMS) {
    return jsonError(`Your dictionary is full (${MAX_TERMS} terms) — remove some terms first`, 422);
  }

  const { term, hint } = result.data;
  try {
    const created = await db.dictionaryTerm.create({ data: { term, hint: hint || null } });
    return NextResponse.json({ term: created }, { status: 201 });
  } catch (e) {
    // Unique-constraint violation — including the race where a concurrent
    // request inserted the same term first.
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
      return jsonError("That term is already in your dictionary", 409);
    }
    throw e;
  }
}
