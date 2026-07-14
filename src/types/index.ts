export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  words?: { word: string; start: number; end: number; probability: number }[];
};

export type KeyTerm = {
  term: string;
  definition: string;
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
