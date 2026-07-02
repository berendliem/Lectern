"use client";

import { useState } from "react";
import { FolderSidebar } from "@/components/dashboard/FolderSidebar";
import { SearchBox } from "@/components/search/SearchBox";
import clsx from "@/lib/clsx";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full min-h-screen">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-zinc-900/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={clsx(
          "fixed inset-y-0 left-0 z-40 transition-transform md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <FolderSidebar onNavigate={() => setSidebarOpen(false)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 sm:px-6">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden"
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <SearchBox />
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
