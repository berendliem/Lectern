"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BrainCircuit,
  CalendarDays,
  CornerDownLeft,
  FileText,
  GraduationCap,
  LayoutGrid,
  Lightbulb,
  MessagesSquare,
  Radio,
  Search,
  Timer,
} from "lucide-react";
import clsx from "@/lib/clsx";

type Command = { id: string; label: string; hint: string; icon: typeof Search; href: string };

const NAV_COMMANDS: Command[] = [
  { id: "nav-library", label: "Courses", hint: "Every lecture, filed by course", icon: LayoutGrid, href: "/" },
  { id: "nav-ask", label: "Ask all courses", hint: "AI across every lecture", icon: BrainCircuit, href: "/ask" },
  { id: "nav-review", label: "Review all", hint: "Spaced-repetition session", icon: GraduationCap, href: "/review" },
  { id: "nav-planner", label: "Planner", hint: "Streaks & schedule", icon: CalendarDays, href: "/planner" },
  { id: "nav-focus", label: "Focus timer", hint: "Pomodoro", icon: Timer, href: "/focus" },
  { id: "nav-feynman", label: "Feynman coach", hint: "Explain it simply", icon: Lightbulb, href: "/feynman" },
  { id: "nav-interview", label: "Interview", hint: "Mock oral exam", icon: MessagesSquare, href: "/interview" },
  { id: "nav-copilot", label: "Live copilot", hint: "During a lecture", icon: Radio, href: "/copilot" },
  { id: "nav-search", label: "Full-text search", hint: "Search everything", icon: Search, href: "/search" },
];

type PageHit = { id: string; label: string; icon: typeof Search; href: string };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pageHits, setPageHits] = useState<PageHit[]>([]);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Global hotkey (⌘K / Ctrl-K) and an event other components can dispatch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  // Debounced full-text page search. State only changes inside the async
  // callback, never synchronously in the effect body.
  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(async () => {
      if (q.length < 2) {
        setPageHits([]);
        return;
      }
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const { results } = await res.json();
        setPageHits(
          (results ?? []).slice(0, 6).map((r: { pageId: string; title: string }) => ({
            id: `page-${r.pageId}`,
            label: r.title,
            icon: FileText,
            href: `/pages/${r.pageId}`,
          }))
        );
        setActive(0);
      } catch {
        // best-effort; keep the last results
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const filteredNav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_COMMANDS;
    return NAV_COMMANDS.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q));
  }, [query]);

  const items = useMemo(
    () => [
      ...filteredNav.map((c) => ({ id: c.id, label: c.label, hint: c.hint, icon: c.icon, href: c.href, group: "Go to" })),
      ...pageHits.map((p) => ({ id: p.id, label: p.label, hint: "Open page", icon: p.icon, href: p.href, group: "Pages" })),
    ],
    [filteredNav, pageHits]
  );

  function close() {
    setOpen(false);
    setQuery("");
    setPageHits([]);
    setActive(0);
  }

  function run(href: string) {
    close();
    router.push(href);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = items[Math.min(active, items.length - 1)];
      if (target) run(target.href);
    }
  }

  if (!open) return null;

  const clampedActive = Math.min(active, Math.max(0, items.length - 1));
  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" onClick={close} aria-hidden="true" />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-zinc-100 px-4">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" strokeWidth={2.2} />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Jump to a page or section…"
            className="w-full bg-transparent py-3.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 sm:block">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {items.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-zinc-400">No matches.</p>}
          {items.map((item, i) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            const Icon = item.icon;
            const isActive = i === clampedActive;
            return (
              <div key={item.id}>
                {showGroup && (
                  <p className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
                    {item.group}
                  </p>
                )}
                <button
                  onClick={() => run(item.href)}
                  onMouseMove={() => setActive(i)}
                  className={clsx(
                    "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                    isActive ? "bg-brand-soft/60" : "hover:bg-zinc-50"
                  )}
                >
                  <Icon className={clsx("h-4 w-4 shrink-0", isActive ? "text-brand" : "text-zinc-400")} strokeWidth={2} />
                  <span className="flex-1 truncate text-[13.5px] font-medium text-zinc-800">{item.label}</span>
                  <span className="truncate text-[12px] text-zinc-400">{item.hint}</span>
                  {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.2} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
