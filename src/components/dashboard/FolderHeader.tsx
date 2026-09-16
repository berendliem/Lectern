"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";

export function FolderHeader({ folderId, name }: { folderId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [next, setNext] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function openRename() {
    setNext(name);
    setError(null);
    setRenaming(true);
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = next.trim();
    if (!trimmed || busy) return;
    if (trimmed === name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        setError("Could not rename the course.");
        return;
      }
      setRenaming(false);
      router.refresh();
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete course "${name}"? Its lectures will be kept but will no longer belong to a course. Any materials uploaded to it — syllabus, slides, readings — will be permanently deleted.`)) return;
    setBusy(true);
    const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openRename} disabled={busy}>
        Rename
      </Button>
      <Button variant="danger" size="sm" onClick={handleDelete} disabled={busy}>
        Delete course
      </Button>
      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename course">
        <form onSubmit={handleRename} className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Course name"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !next.trim()}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
