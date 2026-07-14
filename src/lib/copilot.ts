import { z } from "zod";

// How long each rolling recorder clip runs before it is stopped (producing one
// complete, independently-decodable audio file) and a new clip starts.
export const CLIP_DURATION_MS = 10_000;

// How much of the tail of the running transcript to send to the suggestion
// endpoint on each call, to keep prompts small and focused on recent context.
export const SUGGEST_TRANSCRIPT_CHARS = 2000;

// Ask for new suggestions after this many freshly-transcribed clips land
// (paired with CLIP_DURATION_MS this is roughly every ~20s).
export const SUGGEST_EVERY_N_CLIPS = 2;

export const suggestRequestSchema = z.object({
  transcript: z.string().trim().min(1, "Transcript is required").max(20_000),
});

export const copilotSuggestionSchema = z.object({
  summary: z.string().default(""),
  talkingPoints: z.array(z.string()).default([]),
  followUps: z.array(z.string()).default([]),
});

export type CopilotSuggestion = z.infer<typeof copilotSuggestionSchema>;

export const saveSessionSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  transcript: z.string().trim().min(1, "There is no transcript to save yet"),
});
