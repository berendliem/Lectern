import { NextRequest, NextResponse } from "next/server";
import { searchPages } from "@/lib/fts";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await searchPages(q);
  return NextResponse.json({ results });
}
