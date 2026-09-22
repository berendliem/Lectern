"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { postTask } from "@/lib/tasks";

/**
 * Shown when the material's text no longer matches what its walkthrough was
 * split from — an onQ re-import of a changed file. The old steps still work,
 * so rebuilding is offered, never forced.
 */
export function RebuildNotice({
  materialId,
  folderId,
  written,
}: {
  materialId: string;
  folderId: string;
  /** Steps with an explanation already written, which a rebuild discards. */
  written: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rebuild() {
    const explained =
      written > 0 ? ` and the ${written} step explanation${written === 1 ? "" : "s"} written so far` : "";
    if (
      !confirm(
        `Rebuild this walkthrough from the new text? Your place${explained} ${written > 0 ? "are" : "is"} discarded. Cards made from your misses and your recall history are kept.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const url = `/api/materials/${materialId}/walkthrough`;
    try {
      await postTask(url, "Could not discard the old walkthrough.", { method: "DELETE" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not discard the old walkthrough.");
      setBusy(false);
      return;
    }
    try {
      await postTask(url, "Could not prepare the new walkthrough.");
      router.refresh();
    } catch (e) {
      // The old walkthrough is gone, so a refresh would find nothing to show.
      // Learn on the course page is the retry.
      setError(
        `${e instanceof Error ? e.message : "Could not prepare the new walkthrough."} Use Learn on the course page to try again.`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-amber-800">
          This material has changed since its walkthrough was made. The steps below describe the old version.
        </p>
        <Button variant="ghost" size="sm" onClick={rebuild} disabled={busy}>
          {busy ? "Rebuilding…" : "Rebuild"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          {error}{" "}
          <Link href={`/folders/${folderId}`} className="underline">
            Back to the course
          </Link>
        </p>
      )}
    </div>
  );
}
