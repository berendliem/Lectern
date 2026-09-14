"use client";

import { useState } from "react";
import clsx from "@/lib/clsx";

export function PageTabs({
  tabs,
}: {
  tabs: { id: string; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  // Tabs mount on first visit and then stay mounted. Unmounting them threw
  // away in-flight work: a half-streamed chat answer, an unsent draft, a
  // scroll position — and, before the recording moved into the shell, a
  // lecture recording.
  const [visited, setVisited] = useState<string[]>(tabs[0]?.id ? [tabs[0].id] : []);

  function show(id: string) {
    setActive(id);
    setVisited((seen) => (seen.includes(id) ? seen : [...seen, id]));
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-line">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => show(tab.id)}
            className={clsx(
              "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active === tab.id
                ? "border-brand text-brand-ink"
                : "border-transparent text-muted hover:text-ink-soft"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="py-5">
        {tabs
          .filter((tab) => visited.includes(tab.id))
          .map((tab) => (
            <div key={tab.id} hidden={tab.id !== active}>
              {tab.content}
            </div>
          ))}
      </div>
    </div>
  );
}
