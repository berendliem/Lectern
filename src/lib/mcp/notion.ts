import { callMcpTool } from "@/lib/mcp/client";
import { parseCreatedPage } from "@/lib/mcp/notion-parse";

export const NOTION_SERVER = "notion";

// The hosted server is reached through the `mcp-remote` proxy, whose first run
// opens a browser for OAuth and whose npx cold start is slow. 60s (the client
// default) is not enough for that first call.
const NOTION_TIMEOUT_MS = 120_000;

/**
 * Creates a Notion page under NOTION_PARENT_PAGE_ID with the given markdown as
 * its content, and returns the created page's id and URL.
 *
 * Tool names and shapes are the hosted server's (https://mcp.notion.com/mcp),
 * not the retired open-source `@notionhq/notion-mcp-server`'s: one
 * `notion-create-pages` call takes the title and Notion-flavored markdown
 * together, so there is no separate content-fill step.
 */
export async function createNotionPageWithMarkdown(
  title: string,
  markdown: string
): Promise<{ pageId: string; url: string | null }> {
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId) {
    throw new Error(
      "NOTION_PARENT_PAGE_ID is not set. Add the id of a Notion page (owned by the account you authorize) to .env — synced lecture notes are created under it."
    );
  }

  const created = await callMcpTool(
    NOTION_SERVER,
    "notion-create-pages",
    {
      parent: { page_id: parentPageId },
      pages: [{ properties: { title }, content: markdown }],
      // The page id is needed right now, to store on the lecture; an async
      // task id would be useless here.
      allow_async: false,
    },
    { timeoutMs: NOTION_TIMEOUT_MS }
  );

  const { pageId, url } = parseCreatedPage(created);
  if (!pageId) {
    throw new Error(
      `Notion did not return the created page's id. Check that the authorized account can edit the parent page. Server said: ${created.slice(0, 300)}`
    );
  }
  return { pageId, url };
}

/** Replaces a Notion page's content with the given markdown. */
export async function updateNotionPageMarkdown(pageId: string, markdown: string): Promise<void> {
  await callMcpTool(
    NOTION_SERVER,
    "notion-update-page",
    {
      page_id: pageId,
      command: "replace_content",
      new_str: markdown,
      // A re-sync overwrites the page wholesale; without this the call fails
      // whenever an earlier sync left child pages behind.
      allow_deleting_content: true,
      allow_async: false,
    },
    { timeoutMs: NOTION_TIMEOUT_MS }
  );
}
