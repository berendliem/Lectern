"use client";

import { useState } from "react";
import { Command as CommandIcon, Menu } from "lucide-react";
import { FolderSidebar } from "@/components/dashboard/FolderSidebar";
import { SearchBox } from "@/components/search/SearchBox";
import { CommandPalette } from "@/components/command/CommandPalette";
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
        <header className="flex items-center gap-3 border-b border-zinc-200/80 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-8">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden"
            aria-label="Toggle navigation"
          >
            <Menu className="h-5 w-5" strokeWidth={2} />
          </button>
          <SearchBox />
          <button
            onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
            className="ml-auto hidden items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 sm:flex"
            aria-label="Open command palette"
          >
            <CommandIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
            <kbd className="font-sans">⌘K</kbd>
          </button>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">{children}</div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
