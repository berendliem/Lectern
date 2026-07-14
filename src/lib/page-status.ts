import type { PageStatus } from "@/generated/prisma/enums";

export const PAGE_STATUS_LABEL: Record<PageStatus, string> = {
  DRAFT: "Draft",
  TRANSCRIBING: "Transcribing…",
  TRANSCRIBED: "Transcribed",
  SUMMARIZING: "Summarizing…",
  SUMMARIZED: "Summarized",
  GENERATING_GUIDE: "Generating guide…",
  READY: "Ready",
  ERROR: "Error",
};

export const PAGE_STATUS_TONE: Record<PageStatus, "neutral" | "blue" | "green" | "amber" | "red"> = {
  DRAFT: "neutral",
  TRANSCRIBING: "blue",
  TRANSCRIBED: "blue",
  SUMMARIZING: "amber",
  SUMMARIZED: "amber",
  GENERATING_GUIDE: "amber",
  READY: "green",
  ERROR: "red",
};
