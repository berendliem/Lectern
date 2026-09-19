// src/components/interview/GoLiveButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AudioLines } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { setLive } from "@/components/interview/live/LiveControls";

/** Turns the session into a spoken one. Every launcher lands on this page, so this is the one entry point. */
export function GoLiveButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function goLive() {
    setBusy(true);
    setError(null);
    if (await setLive(sessionId, true)) return router.refresh();
    setBusy(false);
    setError("Couldn't switch to talking. Try again.");
  }

  return (
    <div className="flex flex-col items-start gap-1.5 self-start">
      <Button variant="secondary" size="sm" onClick={() => void goLive()} disabled={busy}>
        <AudioLines className="h-4 w-4" strokeWidth={2} />
        {busy ? "Switching…" : "Talk it through"}
      </Button>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
