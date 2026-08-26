import { callMcpTool } from "@/lib/mcp/client";

export const NOTION_SERVER = "notion";

/**
 * Creates a Notion page under NOTION_PARENT_PAGE_ID and fills it with
 * markdown via the official server's update-page-markdown tool (which accepts
 * markdown directly — no block-JSON conversion needed).
 * Returns the created page's id and URL.
 */
export async function createNotionPageWithMarkdown(
  title: string,
  markdown: string
): Promise<{ pageId: string; url: string | null }> {
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId) {
    throw new Error(
      "NOTION_PARENT_PAGE_ID is not set. Add the id of a Notion page (shared with your integration) to .env — synced lecture notes are created under it."
    );
  }

  const createdText = await callMcpTool(NOTION_SERVER, "post-page", {
    parent: { page_id: parentPageId },
    properties: { title: [{ text: { content: title } }] },
  });

  let pageId: string | undefined;
  let url: string | null = null;
  try {
    const created = JSON.parse(createdText);
    pageId = created?.id;
    url = typeof created?.url === "string" ? created.url : null;
  } catch {
    // fall through to the error below
  }
  if (!pageId) {
    throw new Error("Notion did not return the created page's id. Check the integration's access to the parent page.");
  }

  await updateNotionPageMarkdown(pageId, markdown);
  return { pageId, url };
}

/** Replaces a Notion page's content with the given markdown. */
export async function updateNotionPageMarkdown(pageId: string, markdown: string): Promise<void> {
  await callMcpTool(NOTION_SERVER, "update-page-markdown", {
    page_id: pageId,
    type: "replace_content",
    replace_content: { new_str: markdown, allow_deleting_content: true },
  });
}
