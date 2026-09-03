export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  // Present on transcripts imported from a source that labels speakers
  // (Teams, Zoom), and later on diarized recordings. Absent means unknown,
  // never "no speaker".
  speaker?: string;
  words?: { word: string; start: number; end: number; probability: number }[];
};

export type KeyTerm = {
  term: string;
  definition: string;
};

export type Chapter = {
  title: string;
  startSec: number;
  endSec: number;
};

export type FlashcardDraft = {
  prompt: string;
  idealExplanation: string;
  sourceTerm?: string;
};

export type QuizQuestionDraft =
  | {
      type: "SHORT_ANSWER";
      prompt: string;
      correctAnswer: string;
      explanation?: string;
    }
  | {
      type: "MULTIPLE_CHOICE";
      prompt: string;
      correctAnswer: string;
      options: string[];
      explanation?: string;
    };
