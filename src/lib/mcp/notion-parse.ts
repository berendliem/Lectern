// Pulling the created page's id out of the hosted Notion server's reply. Kept
// free of the MCP client so it can be tested without spawning a server.

const PAGE_URL = /https:\/\/(?:www\.)?notion\.so\/\S*?([0-9a-f]{32})/i;
const ANY_ID = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\b/i;

/**
 * The hosted server answers with human-readable text rather than the raw REST
 * JSON the old server returned, and its wording is not a contract — so take
 * the id from whichever form is present: JSON, a page URL, or a bare id.
 */
export function parseCreatedPage(text: string): { pageId: string | null; url: string | null } {
  try {
    const json = JSON.parse(text);
    const node = Array.isArray(json?.pages) ? json.pages[0] : json;
    const id = typeof node?.id === "string" ? node.id : null;
    const jsonUrl = typeof node?.url === "string" ? node.url : null;
    if (id) return { pageId: normalizeId(id), url: jsonUrl };
  } catch {
    // Not JSON — fall through to the text forms below.
  }

  const urlMatch = text.match(PAGE_URL);
  if (urlMatch) return { pageId: normalizeId(urlMatch[1]), url: urlMatch[0] };

  const idMatch = text.match(ANY_ID);
  return { pageId: idMatch ? normalizeId(idMatch[1]) : null, url: null };
}

/** Notion accepts ids with or without dashes; store the dashless form. */
function normalizeId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}
