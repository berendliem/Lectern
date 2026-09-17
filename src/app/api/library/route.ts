import { NextResponse } from "next/server";
import { libraryStats } from "@/lib/library-export";

export async function GET() {
  return NextResponse.json(await libraryStats());
}
