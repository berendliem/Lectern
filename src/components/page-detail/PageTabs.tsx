"use client";

import { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import clsx from "@/lib/clsx";

type Tab = { id: string; label: string; content: React.ReactNode };

// useSearchParams needs a Suspense boundary above it or a statically rendered
// route fails the build. Both host pages are force-dynamic today; the boundary
// keeps that from being a hidden requirement of reusing this component.
export function PageTabs({ tabs }: { tabs: Tab[] }) {
  return (
    <Suspense fallback={null}>
      <UrlTabs tabs={tabs} />
    </Suspense>
  );
}

function UrlTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The tab lives in the URL so a reload, the back button and a pasted link
  // all land on the same one. An unknown value falls back to the first tab.
  const requested = searchParams.get("tab");
  const initial = tabs.some((tab) => tab.id === requested) ? (requested as string) : tabs[0]?.id;
  const [active, setActive] = useState(initial);
  // Tabs mount on first visit and then stay mounted. Unmounting them threw
  // away in-flight work: a half-streamed chat answer, an unsent draft, a
  // scroll position — and, before the recording moved into the shell, a
  // lecture recording.
  const [visited, setVisited] = useState<string[]>(initial ? [initial] : []);

  function show(id: string) {
    setActive(id);
    setVisited((seen) => (seen.includes(id) ? seen : [...seen, id]));
    const params = new URLSearchParams(searchParams);
    if (id === tabs[0]?.id) params.delete("tab");
    else params.set("tab", id);
    const query = params.toString();
    // Native replaceState, which Next syncs into useSearchParams: router.replace
    // would refetch the server page, and on a course page that re-scores the
    // syllabus coverage for a click that changed nothing.
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
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
