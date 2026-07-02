"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AudioLines, Folder as FolderIcon, GraduationCap, LayoutGrid, Plus, Search } from "lucide-react";
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

const NAV_ITEMS = [
  { href: "/", label: "Library", icon: LayoutGrid },
  { href: "/review", label: "Review", icon: GraduationCap },
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
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-200/80 bg-[#fafafa]">
      <div className="px-4 pb-2 pt-5">
        <Link href="/" className="flex items-center gap-2.5" onClick={onNavigate}>
          <span
            className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#7b3aff] to-[#5a14e8] shadow-sm"
            aria-hidden="true"
          >
            <AudioLines className="h-4.5 w-4.5 text-white" strokeWidth={2.2} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-zinc-900">Notetaker</span>
        </Link>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 pt-4" onClick={onNavigate}>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition-colors",
                active ? "bg-[#ececea] text-zinc-900" : "text-zinc-500 hover:bg-zinc-200/50 hover:text-zinc-800"
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={active ? 2.2 : 2} />
              <span className="flex-1">{label}</span>
              {label === "Review" && dueCount > 0 && (
                <span className="rounded-full bg-brand px-1.5 py-px text-[11px] font-semibold leading-4 text-white">
                  {dueCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-7 flex items-center justify-between pl-[22px] pr-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Folders</span>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700"
          aria-label="New folder"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </div>

      <nav className="mt-1 flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4" onClick={onNavigate}>
        {loading && <p className="px-2.5 py-1.5 text-[13px] text-zinc-400">Loading…</p>}
        {!loading && folders.length === 0 && (
          <p className="px-2.5 py-1.5 text-[13px] text-zinc-400">No folders yet</p>
        )}
        {folders.map((folder) => {
          const active = pathname === `/folders/${folder.id}`;
          return (
            <Link
              key={folder.id}
              href={`/folders/${folder.id}`}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                active ? "bg-[#ececea] font-medium text-zinc-900" : "text-zinc-500 hover:bg-zinc-200/50 hover:text-zinc-800"
              )}
            >
              <FolderIcon
                className={clsx("h-4 w-4 shrink-0", FOLDER_ICON_CLASSES[folderFamily(folder.color)])}
                strokeWidth={2}
                fill="currentColor"
                fillOpacity={0.25}
              />
              <span className="flex-1 truncate">{folder.name}</span>
              <span className="text-[11.5px] tabular-nums text-zinc-400">{folder._count.pages}</span>
            </Link>
          );
        })}
      </nav>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New folder">
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Folder name"
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
