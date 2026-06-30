import { NextResponse } from "next/server";
import { ZodError } from "zod";

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
