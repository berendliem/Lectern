"use client";

import { useState } from "react";
import { ChevronDown, FileDown, FileText } from "lucide-react";
import clsx from "@/lib/clsx";

export function ExportMenu({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
      >
        Export
        <ChevronDown className={clsx("h-3.5 w-3.5 text-zinc-400 transition-transform", open && "rotate-180")} strokeWidth={2} />
      </button>
      <div
        className={clsx(
          "absolute right-0 z-10 mt-1.5 w-44 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg shadow-zinc-900/5",
          open ? "block" : "hidden"
        )}
      >
        <a
          href={`/api/pages/${pageId}/export/markdown`}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50"
        >
          <FileText className="h-4 w-4 text-zinc-400" strokeWidth={2} />
          Markdown
        </a>
        <a
          href={`/api/pages/${pageId}/export/pdf`}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50"
        >
          <FileDown className="h-4 w-4 text-zinc-400" strokeWidth={2} />
          PDF
        </a>
      </div>
    </div>
  );
}
