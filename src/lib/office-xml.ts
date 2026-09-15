// Pure string transforms over Office Open XML parts. No zip handling and no
// browser APIs live here, so these are directly testable; the unzip step lives
// in office-extract.ts.

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Decimal and hex forms; Office writes hex (&#x2019; for a curly quote).
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code: string) => {
      const n = /^x/i.test(code) ? parseInt(code.slice(1), 16) : Number(code);
      // Out-of-range or surrogate code points would throw from
      // String.fromCodePoint; leave the original entity text alone rather
      // than aborting extraction of the whole file over one bad entity.
      if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return match;
      return String.fromCodePoint(n);
    })
    // Ampersand last, or a doubly-encoded "&amp;lt;" would decode twice.
    .replace(/&amp;/g, "&");
}

/** Visible text of one `ppt/slides/slideN.xml` part, runs joined by spaces. */
export function slideXmlToText(xml: string): string {
  const runs = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((m) => decodeEntities(m[1]).trim())
    .filter(Boolean);
  return runs.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Visible text of `word/document.xml`. Paragraph boundaries become newlines,
 * which is what the timestamped-text transcript parser keys off, so runs
 * inside one paragraph must not be split.
 */
export function docxXmlToText(xml: string): string {
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((m) => {
    const runs = [...m[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((r) =>
      decodeEntities(r[1])
    );
    return runs.join("");
  });

  return paragraphs
    .map((p) => p.replace(/\s+$/, "").replace(/^\s+/, ""))
    .filter((p) => p.length > 0)
    .join("\n");
}

/** Slide parts in presentation order — slide10 sorts after slide2, not before. */
export function sortSlideEntries(names: string[]): string[] {
  return names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}
