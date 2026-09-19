import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import type { PageStatus } from "@/generated/prisma/enums";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function withValidation<T>(
  schema: { parseAsync: (data: unknown) => Promise<T> },
  data: unknown
): Promise<{ data: T } | { error: NextResponse }> {
  try {
    return { data: await schema.parseAsync(data) };
  } catch (e) {
    if (e instanceof ZodError) {
      return { error: jsonError(e.issues.map((i) => i.message).join("; "), 422) };
    }
    return { error: jsonError("Invalid request body", 422) };
  }
}

/**
 * Records a failed pipeline stage. A page that was already READY keeps that
 * status: its notes, cards and questions are still there, the task toast has
 * reported the failure, and an ERROR badge with a stale message would outlive
 * both — this is what left a finished lecture reading "terminated" for days.
 */
export async function markStageFailed(id: string, previous: PageStatus, message: string) {
  // updateMany, not update: a page deleted while its stage ran has nothing left
  // to mark, and update's P2025 would turn the stage's error into a 500.
  await db.page.updateMany({
    where: { id },
    data: previous === "READY" ? { status: "READY" } : { status: "ERROR", errorMessage: message },
  });
}
