"use client";

import { useState } from "react";
import clsx from "@/lib/clsx";

export function PageTabs({
  tabs,
}: {
  tabs: { id: string; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={clsx(
              "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active === tab.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="py-5">{tabs.find((tab) => tab.id === active)?.content}</div>
    </div>
  );
}
