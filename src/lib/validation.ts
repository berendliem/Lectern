import { z } from "zod";
import { MAX_SCAN_IMAGE_CHARS, MAX_TEXT_CHARS } from "./limits";
import { MAX_MASTERY_ATTEMPTS } from "./grading";
import { isEarnedSourceTerm } from "./cards";

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  color: z.string().trim().max(32).optional(),
});

export const updateFolderSchema = createFolderSchema.partial().extend({
  // The onQ course this Lectern course imports from; null unlinks it.
  // Brightspace ids are 32-bit.
  onqCourseId: z.number().int().positive().max(2_147_483_647).nullable().optional(),
});

export const createPageSchema = z.object({
  title: z.string().trim().min(1).max(300),
  folderId: z.string().trim().min(1).optional(),
});

const transcriptSegmentSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    text: z.string().trim().min(1).max(10_000),
    speaker: z.string().trim().max(120).optional(),
  })
  // Stored verbatim and later re-emitted as SRT/VTT `start --> end` cues by
  // subtitle-export.ts, so a reversed cue must never reach the database.
  .refine((segment) => segment.end >= segment.start, {
    message: "A transcript segment's end time must not be before its start time.",
    path: ["end"],
  });

export const createPageFromTextSchema = z.object({
  title: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
  folderId: z.string().trim().min(1).optional(),
  // Present when the text came from a timestamped transcript rather than a
  // paste or a PDF. Storing the segments is what makes chapters, subtitle
  // export, and timestamped navigation work on an imported meeting.
  segments: z.array(transcriptSegmentSchema).max(20_000).optional(),
  // Provenance, recorded in Transcript.modelUsed. Constrained because it is
  // written to a column other code reads back.
  source: z.enum(["teams", "zoom", "otter", "subtitles", "import", "slides"]).optional(),
});

export const createMaterialSchema = z.object({
  kind: z.enum(["SYLLABUS", "SLIDES", "READING", "OTHER"]),
  title: z.string().trim().min(1).max(300),
  // Same ceiling as an imported lecture body; a slide deck's text is far
  // smaller than this in practice.
  text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
  sourceFileName: z.string().trim().max(300).optional(),
  slideCount: z.number().int().min(0).max(10_000).optional(),
});

/** One onQ topic to import. The module title only feeds the kind guess. */
export const importOnqTopicSchema = z.object({
  topicId: z.number().int().positive().max(2_147_483_647),
  moduleTitle: z.string().trim().max(300).default(""),
});

/**
 * One photographed page on its way to a vision model. The `data:` URL is
 * pattern-matched, not just length-checked: it is pasted straight into an
 * outbound request body, so a `data:text/html` or an `http://` URL here would
 * turn this route into a fetcher for whatever a caller names.
 */
export const scanNotesSchema = z.object({
  image: z
    .string()
    .max(MAX_SCAN_IMAGE_CHARS, "That page is too large even after downscaling.")
    .regex(
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
      "A page must be a PNG, JPEG or WebP data URL."
    ),
  /** Context for the model ("page 2 of 8"), so a multi-page set reads as one
   *  document. Shape-checked because it is interpolated into a prompt. */
  pageLabel: z
    .string()
    .trim()
    .max(40)
    .regex(/^page \d{1,3} of \d{1,3}$/, "Unexpected page label.")
    .optional(),
});

export const updatePageSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  folderId: z.string().trim().min(1).nullable().optional(),
  notesMarkdown: z.string().optional(),
});

/** PATCH /api/flashcards/[id]: the student rewrites a card the model got wrong. */
export const updateFlashcardSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  idealExplanation: z.string().trim().min(1).max(8000),
});

export const tagOnPageSchema = z.object({
  pageId: z.string().trim().min(1),
  tagName: z.string().trim().min(1).max(64),
});

export const reviewGradeSchema = z.object({
  quality: z.number().int().min(0).max(5),
  /** What the student typed before revealing, when they typed anything. */
  typed: z.string().trim().max(4000).optional(),
  /** Guessing / Fairly sure / Certain. Absent when they skipped the control. */
  confidence: z.number().int().min(1).max(3).optional(),
});

export const reviewSuggestSchema = z.object({
  typed: z.string().trim().min(1).max(4000),
});

export const quizAnswerSchema = z.object({
  answer: z.string().trim().min(0).max(2000),
  // Which go at this question in the current session. Only the first is
  // evidence of recall; after a miss the correct answer is on screen.
  attempt: z.number().int().min(1).max(MAX_MASTERY_ATTEMPTS).default(1),
});

export const liveExplainSchema = z.object({
  context: z.string().trim().min(10).max(8000),
  web: z.boolean().optional(),
});

/** What the live-explain model call returns. The diagram is checked by cleanMermaid. */
export const liveExplainResponseSchema = z.object({
  explanation: z.string().trim().min(1).max(4000),
  diagram: z.string().max(20_000).nullish(),
});

export const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8000),
      })
    )
    .min(1)
    .max(30),
  web: z.boolean().optional(),
});

export const blurtSubmitSchema = z.object({
  dump: z.string().trim().min(1).max(8000),
});

/**
 * The answer being graded is never empty, so a grade with no point in any list
 * is the model failing. Scored, it would be a 0/5 on the ledger for an answer
 * nobody marked; refused, the route's format error asks for a retry instead.
 */
const graded = (m: { covered: unknown[]; missed: unknown[]; wrong: unknown[] }) =>
  m.covered.length + m.missed.length + m.wrong.length > 0;

/**
 * What the reasoning tier returns when it marks a blurt. Every string is
 * capped, not just every array: these become flashcard text and ledger rows,
 * and the model wrote them after reading notes it does not control.
 */
export const blurtResponseSchema = z
  .object({
    covered: z.array(z.string().trim().min(1).max(500)).max(40).default([]),
    missed: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
    wrong: z
      .array(
        z.object({
          claim: z.string().trim().min(1).max(500),
          correction: z.string().trim().min(1).max(1000),
        })
      )
      .max(8)
      .default([]),
  })
  .refine(graded);

/**
 * What the free-text answer grader returns. Capped like every other model
 * response that reaches the screen: the model wrote this after reading a
 * reference answer it does not control.
 */
export const answerGradeResponseSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.string().trim().min(1).max(600),
  missing: z.array(z.string().trim().min(1).max(300)).max(3).default([]),
});

export const feynmanEvaluateSchema = z.object({
  concept: z.string().trim().min(1).max(300),
  /** The lecture the coach was launched from, so the attempt reaches the
   * ledger with a parent. Absent when the coach was opened on its own. */
  pageId: z.string().trim().min(1).max(64).optional(),
  reference: z.string().trim().max(20_000).optional(),
  explanation: z.string().trim().min(1).max(8000),
  priorExplanations: z.array(z.string().trim().min(1).max(8000)).max(10).optional(),
});

export const feynmanFeedbackSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.string().min(1),
  strengths: z.array(z.string().min(1)).default([]),
  gaps: z.array(z.string().min(1)).default([]),
  jargon: z.array(z.string().min(1)).default([]),
  followUp: z.string().default(""),
});

export const conceptMapResponseSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(80),
        group: z.number().int().min(0).max(4).catch(0),
      })
    )
    .min(3)
    .max(24),
  edges: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        label: z.string().max(40).default(""),
      })
    )
    .default([]),
});

export const learnMoreResponseSchema = z.object({
  items: z
    .array(
      z.object({
        concept: z.string().min(1).max(80),
        why: z.string().min(1).max(400),
        nextStep: z.string().min(1).max(300),
      })
    )
    .min(1)
    .max(8),
});

// Terms/hints are interpolated into transcription hotwords and LLM prompts:
// collapse all whitespace (incl. newlines) so an entry can never span lines
// and forge its own instruction lines in a prompt.
const singleLine = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => s.replace(/\s+/g, " ").trim());

export const createDictionaryTermSchema = z.object({
  term: singleLine(64).pipe(z.string().min(1).max(64)),
  hint: singleLine(200).pipe(z.string().max(200)).optional(),
});

export const syllabusTopicsResponseSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        // A syllabus that numbers its weeks past 60 is not a syllabus; a
        // hallucinated 2026 here would sort every real topic above it.
        week: z.number().int().min(0).max(60).nullish(),
      })
    )
    .max(200),
});

/**
 * stdout of the `mac-speech` binary. A local process is still a trust
 * boundary: it prints whatever Apple's Speech framework and FluidAudio hand
 * it, and those numbers end up in subtitle cues and a synced player.
 */
export const macSpeechResultSchema = z.object({
  language: z.string().trim().max(32),
  text: z.string().max(2_000_000),
  words: z
    .array(
      z.object({
        word: z.string().max(200),
        start: z.number().min(0),
        end: z.number().min(0),
        probability: z.number().min(0).max(1),
      })
    )
    .max(500_000),
  speakerSpans: z
    .array(
      z.object({
        start: z.number().min(0),
        end: z.number().min(0),
        speakerId: z.string().trim().min(1).max(120),
      })
    )
    .max(50_000),
});

export const createTopicSchema = z.object({
  title: z.string().trim().min(1).max(300),
  week: z.number().int().min(0).max(60).nullable().optional(),
});

export const updateTopicSchema = createTopicSchema.partial();

export const chaptersResponseSchema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(80),
        startSec: z.number().min(0),
      })
    )
    .min(1)
    .max(12),
});

export const editNotesSchema = z.object({
  instruction: z.string().trim().min(1).max(500),
  selectedText: z.string().trim().min(1).max(20_000).optional(),
});

export const toggleActionItemSchema = z.object({
  done: z.boolean(),
});

export const actionItemsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["ACTION", "DECISION", "QUESTION", "EXAM_HINT"]),
        text: z.string().min(1).max(500),
      })
    )
    .max(40),
});

/**
 * Action items supplied by a caller rather than extracted from a transcript —
 * the study-plan agent's write path. Same three kinds the extractor produces.
 */
export const createActionItemsSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["ACTION", "DECISION", "QUESTION", "EXAM_HINT"]),
        text: z.string().min(1).max(500),
      })
    )
    .min(1)
    .max(50),
});

export const summaryResponseSchema = z.object({
  markdown: z.string().min(1),
  keyTerms: z.array(z.object({ term: z.string().min(1), definition: z.string().min(1) })),
});

export const flashcardsResponseSchema = z.object({
  flashcards: z
    .array(
      z.object({
        prompt: z.string().min(1),
        idealExplanation: z.string().min(1),
        // A label regenerate keeps is the student's, never the model's: a
        // generated card wearing one would survive every regenerate.
        sourceTerm: z
          .string()
          .max(200)
          .optional()
          .transform((term) => (isEarnedSourceTerm(term) ? undefined : term)),
      })
    )
    .min(1),
});

export const quizResponseSchema = z.object({
  questions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("SHORT_ANSWER"),
          prompt: z.string().min(1),
          correctAnswer: z.string().min(1),
          explanation: z.string().optional(),
        }),
        z.object({
          type: z.literal("MULTIPLE_CHOICE"),
          prompt: z.string().min(1),
          correctAnswer: z.string().min(1),
          options: z.array(z.string().min(1)).min(2),
          explanation: z.string().optional(),
        }),
        z.object({
          type: z.literal("CLOZE"),
          // The gap marker is what makes this a cloze rather than a short
          // answer with a word missing, so a prompt without one is a malformed
          // response and gets retried like any other.
          prompt: z.string().min(1).regex(/\{\{[\s\S]+?\}\}/, "a cloze prompt must mark its gap with {{...}}"),
          correctAnswer: z.string().min(1),
          explanation: z.string().optional(),
        }),
        z.object({
          type: z.literal("MATH"),
          prompt: z.string().min(1),
          // One canonical value, in ASCII. A sentence here would be graded as
          // a value by a checker that expects one.
          correctAnswer: z.string().min(1),
          explanation: z.string().optional(),
        }),
      ])
    )
    .min(1),
});

/**
 * A link to fetch a lecture's audio from. Only the shape is checked here —
 * whether it is safe for this machine to go and fetch is decided by
 * assertFetchableMediaUrl, which owns that judgement.
 */
export const mediaUrlSchema = z.object({
  url: z.string().trim().min(1).max(2048),
});

export const debateInterjectSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

/** One agent's utterance. Short by construction: a debate of essays is a reading task. */
export const debateUtteranceResponseSchema = z.object({
  utterance: z.string().trim().min(1).max(1500),
});

/**
 * Three prediction questions, built before the lecture exists. Multiple choice
 * so the guess grades itself: `normalizeQuality` maps a correct choice to 4 and
 * a wrong one to 0, and no second completion is needed for a signal the
 * scheduler never reads anyway.
 */
export const pretestResponseSchema = z.object({
  questions: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(600),
        options: z.array(z.string().trim().min(1).max(300)).length(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().trim().min(1).max(1000),
      })
    )
    .length(3),
});

export const pretestSubmitSchema = z.object({
  answers: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(600),
        options: z.array(z.string().trim().min(1).max(300)).length(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().trim().min(1).max(1000),
        chosenIndex: z.number().int().min(0).max(3),
      })
    )
    .length(3),
});

/** One held pretest question, as it comes back out of `ReviewLog.detail`. */
export const pretestDetailSchema = z.object({
  prompt: z.string(),
  options: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  chosenIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
});

/** PATCH /api/calendar-events/[id]: the student names the course, or clears it. */
export const updateCalendarEventSchema = z.object({
  folderId: z.string().trim().min(1).nullable(),
});

/**
 * A walkthrough's three model responses, and its two request bodies. Every
 * string is capped, not just every array: this text becomes flashcards and
 * ledger rows, and the model wrote it after reading course material it does
 * not control.
 *
 * The array caps truncate rather than reject: each prompt states its cap, but a
 * model that honestly lists one item too many would otherwise fail the call on
 * every retry. Every item is still validated, and nothing past the cap is kept.
 */
function cappedArray<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(item)
    .transform((items) => items.slice(0, max))
    .default([]);
}

export const walkthroughOutlineResponseSchema = z.object({
  headings: cappedArray(z.string().trim().min(1).max(200), 60),
});

export const walkthroughTeachResponseSchema = z.object({
  explanation: z.string().trim().min(1).max(4000),
  recallPrompt: z.string().trim().min(1).max(500),
});

// `covered` is capped low because its length is the score: a padded list would
// mark any answer 5/5 and close every open misconception on the material.
export const walkthroughRecallResponseSchema = z
  .object({
    covered: cappedArray(z.string().trim().min(1).max(500), 12),
    missed: cappedArray(z.string().trim().min(1).max(500), 6),
    wrong: cappedArray(
      z.object({
        claim: z.string().trim().min(1).max(500),
        correction: z.string().trim().min(1).max(1000),
      }),
      6
    ),
  })
  .refine(graded);

export const walkthroughRecallSubmitSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
});

export const walkthroughStepIndexSchema = z.object({
  stepIndex: z.number().int().min(0),
});
