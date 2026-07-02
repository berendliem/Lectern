"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "@/lib/clsx";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";

type Folder = {
  id: string;
  name: string;
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
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50/60 p-4">
      <Link href="/" className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900" onClick={onNavigate}>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm text-white"
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
            pathname === "/" ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
          )}
        >
          All pages
        </Link>
        <Link
          href="/review"
          className={clsx(
            "flex items-center justify-between rounded-lg px-3 py-2 font-medium transition-colors",
            pathname === "/review" ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
          )}
        >
          Review
          {dueCount > 0 && (
            <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
              {dueCount}
            </span>
          )}
        </Link>
        <Link
          href="/search"
          className={clsx(
            "rounded-lg px-3 py-2 font-medium transition-colors",
            pathname === "/search" ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
          )}
        >
          Search
        </Link>
      </nav>

      <div className="mt-6 flex items-center justify-between px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Folders</span>
        <button
          onClick={() => setModalOpen(true)}
          className="text-lg leading-none text-slate-400 hover:text-indigo-600"
          aria-label="New folder"
        >
          +
        </button>
      </div>

      <nav className="mt-1 flex flex-1 flex-col gap-0.5 overflow-y-auto text-sm" onClick={onNavigate}>
        {loading && <p className="px-3 py-2 text-slate-400">Loading…</p>}
        {!loading && folders.length === 0 && (
          <p className="px-3 py-2 text-slate-400">No folders yet</p>
        )}
        {folders.map((folder) => (
          <Link
            key={folder.id}
            href={`/folders/${folder.id}`}
            className={clsx(
              "flex items-center justify-between rounded-lg px-3 py-2 transition-colors",
              pathname === `/folders/${folder.id}`
                ? "bg-indigo-100 text-indigo-700"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <span className="truncate">{folder.name}</span>
            <span className="text-xs text-slate-400">{folder._count.pages}</span>
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
