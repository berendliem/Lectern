/**
 * Ceiling on a stored body of text — an imported lecture or a material.
 *
 * Lives on its own so the browser-side importers can check it before
 * extracting megabytes of PDF text only to have the API reject it, without
 * pulling zod (and every schema in validation.ts) into the client bundle.
 */
export const MAX_TEXT_CHARS = 500_000;
