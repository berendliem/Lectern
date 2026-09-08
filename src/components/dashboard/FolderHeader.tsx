"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function FolderHeader({ folderId, name }: { folderId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleRename() {
    const next = prompt("Course name", name)?.trim();
    if (!next || next === name) return;
    setBusy(true);
    const res = await fetch(`/api/folders/${folderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert("Could not rename the course.");
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
      <Button variant="secondary" size="sm" onClick={handleRename} disabled={busy}>
        Rename
      </Button>
      <Button variant="danger" size="sm" onClick={handleDelete} disabled={busy}>
        Delete course
      </Button>
    </>
  );
}
