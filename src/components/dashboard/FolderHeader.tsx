"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function FolderHeader({ folderId, name }: { folderId: string; name: string }) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm(`Delete folder "${name}"? Pages inside it will become unfoldered.`)) return;
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
      Delete folder
    </Button>
  );
}
