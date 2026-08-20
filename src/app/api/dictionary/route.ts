import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { createDictionaryTermSchema } from "@/lib/validation";

export async function GET() {
  const terms = await db.dictionaryTerm.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ terms });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(createDictionaryTermSchema, body);
  if ("error" in result) return result.error;

  const { term, hint } = result.data;
  const existing = await db.dictionaryTerm.findUnique({ where: { term } });
  if (existing) return jsonError("That term is already in your dictionary", 409);

  const created = await db.dictionaryTerm.create({ data: { term, hint: hint || null } });
  return NextResponse.json({ term: created }, { status: 201 });
}
