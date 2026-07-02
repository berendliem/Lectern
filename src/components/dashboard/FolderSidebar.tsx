"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "@/lib/clsx";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { folderFamily, FOLDER_DOT_CLASSES } from "@/lib/folder-colors";

type Folder = {
  id: string;
  name: string;
  color: string | null;
  _count: { pages: number };
};

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
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-200 bg-[#fafafa] p-4">
      <Link href="/" className="mb-6 flex items-center gap-2 text-lg font-semibold text-zinc-900" onClick={onNavigate}>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#6923ff] to-[#a06dff] text-sm text-white"
          aria-hidden="true"
        >
          ✎
        </span>
        AI Notetaker
      </Link>

      <nav className="flex flex-col gap-1 text-sm" onClick={onNavigate}>
        <Link
          href="/"
          className={clsx(
            "rounded-lg px-3 py-2 font-medium transition-colors",
            pathname === "/" ? "bg-[#efeded] text-zinc-900" : "text-zinc-600 hover:bg-zinc-100"
          )}
        >
          All pages
        </Link>
        <Link
          href="/review"
          className={clsx(
            "flex items-center justify-between rounded-lg px-3 py-2 font-medium transition-colors",
            pathname === "/review" ? "bg-[#efeded] text-zinc-900" : "text-zinc-600 hover:bg-zinc-100"
          )}
        >
          Review
          {dueCount > 0 && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
              {dueCount}
            </span>
          )}
        </Link>
        <Link
          href="/search"
          className={clsx(
            "rounded-lg px-3 py-2 font-medium transition-colors",
            pathname === "/search" ? "bg-[#efeded] text-zinc-900" : "text-zinc-600 hover:bg-zinc-100"
          )}
        >
          Search
        </Link>
      </nav>

      <div className="mt-6 flex items-center justify-between px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Folders</span>
        <button
          onClick={() => setModalOpen(true)}
          className="text-lg leading-none text-zinc-400 hover:text-brand"
          aria-label="New folder"
        >
          +
        </button>
      </div>

      <nav className="mt-1 flex flex-1 flex-col gap-0.5 overflow-y-auto text-sm" onClick={onNavigate}>
        {loading && <p className="px-3 py-2 text-zinc-400">Loading…</p>}
        {!loading && folders.length === 0 && (
          <p className="px-3 py-2 text-zinc-400">No folders yet</p>
        )}
        {folders.map((folder) => (
          <Link
            key={folder.id}
            href={`/folders/${folder.id}`}
            className={clsx(
              "flex items-center justify-between rounded-lg px-3 py-2 transition-colors",
              pathname === `/folders/${folder.id}`
                ? "bg-[#efeded] text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100"
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", FOLDER_DOT_CLASSES[folderFamily(folder.color)])}
                aria-hidden="true"
              />
              <span className="truncate">{folder.name}</span>
            </span>
            <span className="text-xs text-zinc-400">{folder._count.pages}</span>
          </Link>
        ))}
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
