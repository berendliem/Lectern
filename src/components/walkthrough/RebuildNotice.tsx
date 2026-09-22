"use client";

import { useState } from "react";
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
  written,
}: {
  materialId: string;
  /** Steps with a question and explanation already written, which a rebuild discards. */
  written: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rebuild() {
    const explained =
      written > 0
        ? `, the questions and explanations written for ${written} step${written === 1 ? "" : "s"},`
        : "";
    if (
      !confirm(
        `Rebuild this walkthrough from the new text? Your place${explained} and the last score shown on each step are discarded. Cards made from your misses and your recall history are kept.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The route swaps the new steps in only once they are built, so a
      // failure leaves the old walkthrough as it was.
      await postTask(`/api/materials/${materialId}/walkthrough?rebuild=1`, "Could not rebuild the walkthrough.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rebuild the walkthrough.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
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
          {error}
        </p>
      )}
    </div>
  );
}
