"use client";

import { Globe } from "lucide-react";
import clsx from "@/lib/clsx";

/**
 * Lets one question reach the web as well as the notes. Off by default and
 * per surface: a search is billed on top of the reply, so it is a choice made
 * for the question at hand rather than a setting that quietly stays on.
 */
export function WebSearchToggle({
  on,
  onChange,
  small = false,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title={on ? "Web search on: replies may use web results" : "Web search off: replies use your notes only"}
      className={clsx(
        "flex shrink-0 items-center gap-1.5 rounded-xl border font-medium transition-colors",
        small ? "h-8 px-2 text-xs" : "h-10 px-2.5 text-[12.5px]",
        on
          ? "border-brand-border bg-brand-soft text-brand-ink"
          : "border-line bg-surface text-muted hover:border-line-strong hover:bg-surface-2"
      )}
    >
      <Globe className="h-4 w-4" strokeWidth={2.2} />
      Web
    </button>
  );
}
