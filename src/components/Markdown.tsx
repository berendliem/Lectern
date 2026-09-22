import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { protectCurrency } from "@/lib/inline-math";

/**
 * The one place markdown rendering is configured. Every surface that shows
 * model-written markdown — notes, chat replies, the study plan — renders
 * through here, so a plugin added once shows up everywhere rather than in
 * whichever component someone remembered to update.
 *
 * Single-dollar inline math stays on, because `$x^2$` is what the models emit.
 * That collides with prices in prose, so `protectCurrency` escapes the dollars
 * that open an amount before remark-math can read a sentence as a formula.
 * Fenced code is left out of that: a `$5` in a code sample or a diagram label is
 * literal text, and an inserted backslash would show up in it.
 */
const FENCED_CODE = /(```[\s\S]*?```)/;

// A link the model wrote is followed only by a click, but it still should not
// hand the destination this page's URL or rank it.
const LINK_DEFAULTS: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
};

export function Markdown({ children, components }: { children: string; components?: Components }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{ ...LINK_DEFAULTS, ...components }}
    >
      {children
        .split(FENCED_CODE)
        .map((part, i) => (i % 2 === 1 ? part : protectCurrency(part)))
        .join("")}
    </ReactMarkdown>
  );
}
