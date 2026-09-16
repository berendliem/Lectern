"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";

export function NewPageButton({ folderId }: { folderId?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    const res = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, folderId }),
    });
    setSubmitting(false);
    if (res.ok) {
      const { page } = await res.json();
      setOpen(false);
      setTitle("");
      router.push(`/pages/${page.id}`);
    }
  }

  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)} className="shadow-sm shadow-brand/20">
        <Plus className="h-4 w-4" strokeWidth={2.2} />
        New lecture
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New lecture">
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <Input
            placeholder="Lecture title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
