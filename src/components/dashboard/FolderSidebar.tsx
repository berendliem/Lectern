"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  BrainCircuit,
  CalendarDays,
  Folder as FolderIcon,
  GraduationCap,
  LayoutGrid,
  Lightbulb,
  MessagesSquare,
  Plug,
  Plus,
  Radio,
  Search,
  Timer,
} from "lucide-react";
import clsx from "@/lib/clsx";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { folderFamily, FOLDER_ICON_CLASSES } from "@/lib/folder-colors";

type Folder = {
  id: string;
  name: string;
  color: string | null;
  _count: { pages: number };
};

// The global tier: everything that works across every course. Course-scoped
// and lecture-scoped entry points live on the course page and the lecture
// page respectively, where they start with context instead of a blank slate.
const NAV_ITEMS = [
  { href: "/", label: "Courses", icon: LayoutGrid },
  { href: "/ask", label: "Ask all courses", icon: BrainCircuit },
  { href: "/review", label: "Review all", icon: GraduationCap },
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/focus", label: "Focus timer", icon: Timer },
  { href: "/feynman", label: "Feynman coach", icon: Lightbulb },
  { href: "/interview", label: "Interview", icon: MessagesSquare },
  { href: "/copilot", label: "Live copilot", icon: Radio },
  { href: "/dictionary", label: "Dictionary", icon: BookOpen },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/search", label: "Search", icon: Search },
];

export function FolderSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const [refreshIndex, setRefreshIndex] = useState(0);
  const [dueCount, setDueCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetch("/api/folders")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) {
          setFolders(data.folders ?? []);
          setLoading(false);
        }
      });
    fetch("/api/review/due?limit=1")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) setDueCount(data.total ?? 0);
      });
    return () => {
      ignore = true;
    };
    // pathname is deliberately a dependency: navigating (e.g. after a review
    // session or generating flashcards) refreshes the due-count badge.
  }, [refreshIndex, pathname]);

  function loadFolders() {
    setRefreshIndex((i) => i + 1);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setSubmitting(false);
    if (res.ok) {
      const { folder } = await res.json();
      setName("");
      setModalOpen(false);
      loadFolders();
      router.push(`/folders/${folder.id}`);
    }
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface-2">
      <div className="px-4 pb-3 pt-5">
        <Link href="/" className="flex items-center" onClick={onNavigate}>
          {/* The lockup already contains the wordmark, so the alt text is the
              app name and no text label sits beside it. Two files rather than a
              CSS filter: the navy has to lift on a dark ground while the gold
              stays gold, which no single filter does. */}
          <Image
            src="/brand/lectern-lockup.png"
            alt="Lectern"
            width={2172}
            height={724}
            priority
            className="h-12 w-auto dark:hidden"
          />
          <Image
            src="/brand/lectern-lockup-dark.png"
            alt=""
            aria-hidden="true"
            width={2172}
            height={724}
            priority
            className="hidden h-12 w-auto dark:block"
          />
        </Link>
      </div>

      <div className="mt-4 pl-[22px] pr-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-2">Global</span>
      </div>

      <nav className="mt-1 flex flex-col gap-0.5 px-3" onClick={onNavigate}>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition-all",
                active
                  ? "bg-brand text-white shadow-[inset_3px_0_0_0_var(--gold)]"
                  : "text-muted hover:bg-surface/70 hover:text-ink"
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={active ? 2.4 : 2} />
              <span className="flex-1">{label}</span>
              {href === "/review" && dueCount > 0 && (
                <span
                  className={clsx(
                    "rounded-full px-1.5 py-px text-[11px] font-semibold leading-4",
                    active ? "bg-surface/25 text-white" : "bg-brand text-white"
                  )}
                >
                  {dueCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-7 flex items-center justify-between pl-[22px] pr-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-2">Your courses</span>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-md p-1 text-muted-2 transition-colors hover:bg-surface-3 hover:text-ink-soft"
          aria-label="New course"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </div>

      <nav className="mt-1 flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4" onClick={onNavigate}>
        {loading && <p className="px-2.5 py-1.5 text-[13px] text-muted-2">Loading…</p>}
        {!loading && folders.length === 0 && (
          <p className="px-2.5 py-1.5 text-[13px] text-muted-2">No courses yet</p>
        )}
        {folders.map((folder) => {
          const active = pathname === `/folders/${folder.id}`;
          return (
            <Link
              key={folder.id}
              href={`/folders/${folder.id}`}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                active
                  ? "bg-brand-soft font-medium text-brand-ink shadow-[inset_3px_0_0_0_var(--gold)]"
                  : "text-muted hover:bg-surface/70 hover:text-ink"
              )}
            >
              <FolderIcon
                className={clsx("h-4 w-4 shrink-0", FOLDER_ICON_CLASSES[folderFamily(folder.color)])}
                strokeWidth={2}
                fill="currentColor"
                fillOpacity={0.25}
              />
              <span className="flex-1 truncate">{folder.name}</span>
              <span className="text-[11.5px] tabular-nums text-muted-2">{folder._count.pages}</span>
            </Link>
          );
        })}
      </nav>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New course">
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Course name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </aside>
  );
}
