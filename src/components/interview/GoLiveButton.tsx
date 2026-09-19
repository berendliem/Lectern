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
  const router = useRouter();

  async function goLive() {
    setBusy(true);
    if (await setLive(sessionId, true)) router.refresh();
    else setBusy(false);
  }

  return (
    <Button variant="secondary" size="sm" onClick={goLive} disabled={busy} className="self-start">
      <AudioLines className="h-4 w-4" strokeWidth={2} />
      {busy ? "Switching…" : "Talk it through"}
    </Button>
  );
}
