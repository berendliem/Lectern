/**
 * The MCP server's only way to reach Lectern's data: HTTP against the running
 * app. It holds no Prisma client on purpose — request validation, FTS
 * re-indexing, and the single database writer all stay in the API routes.
 *
 * Imports nothing: scripts/lectern-mcp.ts loads this file outside Next, where
 * `@/` aliases do not resolve and no Prisma client is initialized.
 */

/** Same cap the chat and action-item routes use for model context. */
export const MAX_TEXT_CHARS = 24_000;

export function lecternBaseUrl(): string {
  return process.env.LECTERN_BASE_URL ?? "http://127.0.0.1:3000";
}

/** Cut long text and say so, rather than letting the model assume it saw all of it. */
export function truncate(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated — ${text.length - max} more characters]`;
}

export async function lecternFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${lecternBaseUrl()}${path}`, init);
  } catch {
    // A bare "fetch failed" tells the agent nothing it can act on, and this is
    // by far the most likely failure: the dev server is not up.
    throw new Error(`Lectern is not reachable at ${lecternBaseUrl()} — is the dev server running?`);
  }

  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `${path} returned ${res.status}`);
  return body as T;
}
