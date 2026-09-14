"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export function CoursePicker({
  eventId,
  folders,
  open,
  onClose,
}: {
  eventId: string;
  folders: { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function pick(folderId: string) {
    setSaving(folderId);
    setError(null);
    const res = await fetch(`/api/calendar-events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    setSaving(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save the course");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="Choose a course">
      <div className="flex flex-col gap-1">
        {folders.map((f) => (
          <Button key={f.id} variant="ghost" className="justify-start" disabled={saving !== null} onClick={() => pick(f.id)}>
            {f.name}
          </Button>
        ))}
        {folders.length === 0 && <p className="text-[13px] text-muted-2">No courses yet.</p>}
        {error && (
          <p role="alert" className="text-[13px] font-semibold text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
