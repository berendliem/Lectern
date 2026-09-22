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

// Model-written markdown is untrusted. An image would be fetched on render,
// so it shows as its alt text (the CSP in next.config.ts is the backstop). A
// link is followed only by a click, but it still should not hand the
// destination this page's URL or rank it.
const UNTRUSTED_DEFAULTS: Components = {
  img: ({ alt }) => <>{alt}</>,
  // Every prop passes through (footnote ids and aria labels live on links)
  // except the hast node, which is no DOM attribute.
  a: (props) => <a {...{ ...props, node: undefined }} rel="noreferrer nofollow" />,
};

export function Markdown({ children, components }: { children: string; components?: Components }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{ ...UNTRUSTED_DEFAULTS, ...components }}
    >
      {children
        .split(FENCED_CODE)
        .map((part, i) => (i % 2 === 1 ? part : protectCurrency(part)))
        .join("")}
    </ReactMarkdown>
  );
}
