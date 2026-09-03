"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function FolderHeader({ folderId, name }: { folderId: string; name: string }) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm(`Delete course "${name}"? Its lectures will be kept but will no longer belong to a course. Any materials uploaded to it — syllabus, slides, readings — will be permanently deleted.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setDeleting(false);
    }
  }

  return (
    <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
      Delete course
    </Button>
  );
}
