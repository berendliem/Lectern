/**
 * How the MCP server decides which course it may read.
 *
 * Two modes, chosen once at startup by whether LECTERN_FOLDER_ID is set:
 *
 * - **Pinned** (env set) — the study-plan agent's mode. The course is fixed by
 *   the environment and is never a tool argument, so an unattended run that
 *   pre-approves `mcp__lectern__*` cannot read a course it was not pointed at.
 * - **Unpinned** (env unset) — an interactive session's mode. The caller names
 *   the course per call, and `list_courses` tells them what exists. A human
 *   approves this server, so the scoping is theirs to give.
 *
 * Kept out of scripts/lectern-mcp.ts because that file's top level connects a
 * stdio transport and so cannot be imported by a test. Same split as
 * args.ts / args.test.ts.
 */

/** The pinned course, or null for unpinned mode. */
export function pinnedFolderId(): string | null {
  const value = process.env.LECTERN_FOLDER_ID;
  if (value === undefined) return null;
  // An env var set to "" or whitespace is a misconfiguration, not a pin. Falling
  // back to unpinned would silently widen an unattended run's reach, so refuse.
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error("LECTERN_FOLDER_ID is set but empty — unset it for unpinned mode, or give it a course id");
  }
  return trimmed;
}

/**
 * The course one tool call may touch: the pin if there is one, else the caller's
 * own argument. A pinned server ignores the argument entirely — the tool schemas
 * do not declare it in that mode.
 */
export function resolveFolderId(pinned: string | null, args: { folderId?: string }): string {
  if (pinned !== null) return pinned;
  const folderId = args.folderId?.trim();
  if (!folderId) {
    throw new Error("folderId is required: this server is unpinned. Call list_courses to see the available courses.");
  }
  return folderId;
}
