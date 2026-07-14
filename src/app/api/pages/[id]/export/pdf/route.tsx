import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { PageDocument } from "@/lib/pdf/PageDocument";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: { transcript: true, notes: true, flashcards: { orderBy: { createdAt: "asc" } } },
  });
  if (!page) return jsonError("Page not found", 404);

  const buffer = await renderToBuffer(<PageDocument page={page} />);
  const filename = `${page.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "notes"}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
