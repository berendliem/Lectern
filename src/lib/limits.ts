/**
 * Ceiling on a stored body of text — an imported lecture or a material.
 *
 * Lives on its own so the browser-side importers can check it before
 * extracting megabytes of PDF text only to have the API reject it, without
 * pulling zod (and every schema in validation.ts) into the client bundle.
 */
export const MAX_TEXT_CHARS = 500_000;

/** Longest edge, in pixels, a scanned page is downscaled to before it is sent
 *  to a vision model. A phone photo is far larger than any model reads at, and
 *  the extra pixels cost upload time and tokens, not accuracy. */
export const SCAN_MAX_EDGE = 2000;

/** Ceiling on one page's `data:` URL. A 2000px JPEG lands well under this;
 *  the headroom is for a dense page, not for an un-resized original. */
export const MAX_SCAN_IMAGE_CHARS = 8_000_000;

/** Pages that can be joined into one scanned material. Each is its own model
 *  call, so this is a patience limit as much as a size one. */
export const MAX_SCAN_PAGES = 40;

/** A .pptx or .docx is unzipped in the browser, so its size is a memory limit
 *  on the tab. Decks with embedded video run to hundreds of MB; the text in
 *  them does not. */
export const MAX_OFFICE_FILE_BYTES = 100_000_000;

/** One slide or document body XML part, by its declared size in the archive.
 *  A real one is kilobytes; a crafted one can inflate to gigabytes. */
export const MAX_OFFICE_PART_BYTES = 20_000_000;
