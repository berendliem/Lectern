# Live interview: voice mode, captions, transcript, correcting tutor

**Date:** 2026-09-18
**Branch:** `feat/live-interview`
**Status:** Approved design, awaiting spec review

## Goal

Turn the interview into a hands-free spoken conversation, like Claude's voice
mode, across all three modes (Viva, Protégé, Debate). While the tutor speaks,
captions highlight each word as it is said. When the session ends, a transcript
pulls every mistake into a study sheet.

The tutor's job changes from grading to teaching. When an answer is wrong or
only partly right, it names the specific slip, fixes it, and works through a
concrete example from the course material, not a restatement of the slides.
Then it asks a variant question for the student to try.

The typed interview stays as it is. Live is a choice on the start form.

## Decisions

| Question | Decision |
|---|---|
| Turn-taking | Hands-free with barge-in: silence ends the student's turn; talking over the tutor stops it |
| Wrong answer | Correct it, give a worked example, ask one variant question, then move on |
| Modes | All three: Viva, Protégé, Debate |
| Student speech | Chrome `SpeechRecognition` for live captions; local Whisper/mac-speech produces the text that is saved and graded |
| Tutor speech | Streamed LLM reply, split into sentences, each spoken by the existing Kokoro worker |

Rejected: waiting for the whole reply before speaking (3–8 s of silence per turn),
and hosted realtime voice APIs (they replace OpenRouter/Ollama and Kokoro, cost
per minute, and send audio off the machine).

## 1. Turn loop

A client component, `LiveSession`, replaces the answer box when the session has
`live = true`.

1. **Listening.** The mic stays open (`getUserMedia` with `echoCancellation: true`).
   `SpeechRecognition` shows interim words in the caption strip, and
   `MediaRecorder` records the same stream.
2. **End of turn.** Once the mic level stays below the silence threshold for
   about 1.2 s, the recording is posted to the existing
   `/api/interview/[id]/transcribe-answer` route. The returned text replaces the
   live text in the caption, and it is the text that gets saved and graded.
3. **Tutor reply.** `POST /api/interview/[id]/live-turn` saves the answer, then
   streams the tutor's reply. The client cuts the stream into sentences and
   queues each one into `say()`, with the following sentence passed as `next`
   so it is pre-rendered. Speech starts with the first sentence.
4. **Barge-in.** If the mic level stays above the barge-in threshold for about
   300 ms while the tutor is speaking, the client calls `silence()`, drops the
   queue, and reports the character offset the captions had reached. It then
   goes back to step 1.
5. **End.** An End button, or the student saying "end session", completes the
   session and opens the transcript view.

Without `SpeechRecognition` (Firefox, Safari), there are no interim captions of
the student's speech. The student's text appears once Whisper returns, and the
rest of the loop is unchanged.

States: `listening → transcribing → thinking → speaking → listening`, plus
`speaking → interrupted → listening`. This lives in a pure reducer in
`src/lib/live-interview.ts`.

## 2. Tutor behaviour

### One streamed call per turn

The tutor speaks its reply, then ends with one machine-readable line:

```
@@GRADE {"score":3,"verdict":"partial","improvement":"…","correction":"…","example":"…"}
```

The server holds this line back from the stream sent to the client and checks
it against Zod schemas that extend the existing feedback schemas. The score and
improvement feed `writeRecallSafely` exactly as the typed route does now. If the
line is missing or invalid, which small Ollama models are prone to, the server
runs the current grading call after the turn. The spoken verdict and the stored
grade come from one judgment, so they cannot disagree.

`verdict` is one of `right | partial | wrong`.

`callOpenRouterText` and `callOllama` currently return whole replies.
`callLLMStream` is added to `llm.ts`, with streaming implementations in
`openrouter.ts` (SSE) and `ollama.ts` (`stream: true`, NDJSON).

### Shared rule block: `LIVE_TUTOR_RULES`

- Speak in plain spoken English. No markdown, lists, or symbols a voice would
  read out.
- Never restate the notes. Show the idea applied: a worked problem with real
  numbers, a concrete scenario, or a counter-example.
- Draw examples from the retrieved course material. That is `searchCourse` for
  a session with a course topic, and the lecture notes and transcript for a
  lecture session. Invent an example only when the material has none, and say
  that it is invented.
- Keep a turn under about 120 spoken words.
- Keep the existing `UNTRUSTED_CONTENT_CLAUSE`.

### Viva

- **Right:** a one-line confirmation, one sentence on where the idea shows up,
  then the next question.
- **Partial or wrong:** "You said X; it's actually Y, because…". Then a worked
  example, then a variant question. The variant turn is saved with `retryOf`
  pointing at the missed turn.
- **Retry:** right means move on. Still wrong means the tutor gives the answer
  with a second short example and moves on. One retry at most.

### Protégé

- The confused-classmate persona stays, but it no longer lets mistakes pass.
  When the explanation is wrong, it pushes back with a concrete case ("wait,
  then what happens when the rate is zero? My notes say…").
- If the student's second attempt is still wrong, it "looks it up" and reads out
  the correct version with an example, then asks the student to explain it back
  in one line.
- Grading keeps the Feynman rubric.

### Debate

- Barge-in is the interjection. The student talks over an agent and the agent
  stops mid-sentence.
- The existing interjection grader runs. If the point is wrong, the interrupted
  agent rebuts it in character, with the correction and an example. If it is
  right, the agent concedes and the other side responds.
- Each agent speaks with its own Kokoro voice (for example `am_michael` and
  `bf_emma`). Captions carry a speaker label in the agent's colour.
- Debate has no retry step.

## 3. Captions and transcript

### Word timing

`SayOptions` gains an optional `onWord(index: number)` callback.

- **Kokoro:** when a sentence's buffer starts, `wordSchedule(text, durationSec)`
  (pure, in `src/lib/live-interview.ts`) spreads the duration over the words by
  character count, with extra weight after punctuation. A
  `requestAnimationFrame` loop reads `AudioContext.currentTime` and fires
  `onWord` as each boundary passes.
- **Browser voice:** `SpeechSynthesisUtterance.onboundary` gives the real char
  index, which is mapped to a word index.
- Existing callers (`ReadAloudBar`, `RecapPlayer`) don't pass `onWord`, so their
  behaviour doesn't change.

### Caption strip

- It shows the current sentence. Words already spoken are at full contrast, the
  current word has a highlight pill, and words still to come are dimmed.
- Debate adds a speaker label in the agent's colour.
- The student's words appear in a separate tint, with interim text in italics
  until the Whisper text replaces it.
- A CC toggle shows or hides the strip, and the choice is stored in
  `localStorage` (read inside try/catch).
- `aria-live="polite"` announces each finished sentence, not each word. The
  highlight is a state change rather than an animation, so it stays on under
  `prefers-reduced-motion`.

### Transcript view

Ending a live session opens `/interview/[id]`, which renders a transcript layout
when `live = true`:

1. **Conversation.** Every turn in order, with speaker labels. An interrupted
   tutor reply shows `spoken` up to `interruptedAt`, followed by
   "— (you cut in)".
2. **What to fix.** One card for each turn whose verdict is `partial` or
   `wrong`: what the student said, then the correction, then the example, then
   the result of the retry (found through `retryOf`).
3. **Copy as Markdown / Download .md.**

Out of scope: replaying the tutor's audio. It isn't stored, and Kokoro can
re-speak the text.

## 4. Data, errors, testing

### Schema (one additive migration)

```prisma
model InterviewSession {
  // …
  live Boolean @default(false)
}

model InterviewTurn {
  // …
  spoken        String?  // the tutor's full spoken reply
  interruptedAt Int?     // char offset in `spoken` where the student cut in
  retryOf       String?  // id of the turn this variant question retries
}
```

`question` still holds only the question, so the typed-mode code is untouched.
`feedback` JSON gains `verdict`, `correction` and `example`.

### Routes

- `POST /api/interview/[id]/live-turn`: `{ turnId, answer, transcriptSource: "whisper" | "browser" }`.
  Saves the answer first, then streams the reply as `text/plain` chunks with the
  `@@GRADE` line removed. After the stream finishes, it writes `spoken`, the
  feedback, the recall event, and the next turn.
- `POST /api/interview/[id]/live-turn/interrupt`: `{ turnId, interruptedAt }`.
- For Debate, `debate/advance` and `debate/interject` get a streaming variant
  behind a `live` flag. Their grading logic is reused.
- Inputs are validated with Zod in `src/lib/validation.ts`, like the existing routes.

### Errors

| Failure | Behaviour |
|---|---|
| Stream drops mid-reply | Speak what arrived, then show "Lost the tutor — tap to retry". The retry requests the reply only; the answer is already saved |
| Whisper fails | Grade on the browser text and mark the turn "(browser transcript)" in the transcript |
| No text at all | The tutor says "I didn't catch that" and listens again |
| Mic denied or missing | Fall back to the typed interview with a one-line notice |
| `@@GRADE` missing or invalid | Run the existing grading call after the turn |
| False barge-ins | A sensitivity slider in the live screen's settings, stored per browser |

### Testing

Unit tests (`node --test`, `src/lib/live-interview.test.ts`):

- `wordSchedule`: timings rise monotonically, add up to the duration, and give
  punctuation extra weight.
- Streaming sentence splitter: no split on "e.g.", "3.14" or "Dr.", and a
  sentence split across chunks is handled.
- `@@GRADE` trailer parser: the marker split across chunks, a missing trailer,
  invalid JSON.
- Turn reducer: every transition, and the one-retry cap.

Manual browser checklist, in the plan: hands-free turn with speakers, with
headphones, barge-in, a false-trigger cough, Firefox with no
`SpeechRecognition`, mic denied, Kokoro still loading, and a Debate
interjection.
