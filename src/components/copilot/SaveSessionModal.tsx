"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function SaveSessionModal({
  open,
  onClose,
  onSave,
  saving,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (title: string) => void;
  saving: boolean;
  error: string | null;
}) {
  const [title, setTitle] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(title.trim());
  }

  return (
    <Modal open={open} onClose={onClose} title="Save as lecture">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-[13px] text-zinc-500">
          This saves the live transcript as a new lecture page you can summarize, quiz yourself on, and review later.
        </p>
        <Input
          autoFocus
          placeholder="Session title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {error && <p className="text-[13px] text-blush-ink">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="brand" disabled={saving || !title.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
