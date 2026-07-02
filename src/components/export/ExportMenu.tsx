"use client";

import { useState } from "react";
import clsx from "@/lib/clsx";

export function ExportMenu({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      >
        Export ▾
      </button>
      <div
        className={clsx(
          "absolute right-0 z-10 mt-1 w-40 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg",
          open ? "block" : "hidden"
        )}
      >
        <a
          href={`/api/pages/${pageId}/export/markdown`}
          className="block px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Markdown (.md)
        </a>
        <a
          href={`/api/pages/${pageId}/export/pdf`}
          className="block px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          PDF (.pdf)
        </a>
      </div>
    </div>
  );
}
