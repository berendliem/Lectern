# Lectern Phase 4 — On-device transcription with speakers

**Goal:** A saved recording transcribes on this machine, with word timings, the personal dictionary still biasing the spelling, and each segment labelled with who spoke it. Removing the binary falls back to Whisper silently; diarization failing alone still returns a speaker-less transcript.

**Architecture:** `TRANSCRIBE_PROVIDER=whisper|apple`, mirroring `LLM_PROVIDER`. `src/lib/transcribe.ts` dispatches; `src/lib/whisper-client.ts` is untouched and stays the fallback. The `apple` provider shells out to `mac-speech`, a Swift CLI built once by `setup.sh` behind a Darwin + macOS 26 guard, with FluidAudio as its only SPM dependency. Apple's `SpeechTranscriber` produces the text and per-word timings; FluidAudio's diarizer produces speaker spans over the same audio; the two are joined on the Node side.

**Spec:** `docs/superpowers/specs/2026-08-28-lectern-course-library-design.md` — §10 transcription provider, §10.1 why both engines, §10.2 the binary and alignment, §10.3 audio format and first-run downloads, §13 Phase 4.

## Global constraints

- No schema change. `TranscriptSegment.speaker` already exists and is free text.
- No caller signature change. `transcribeAudio(buffer, filename, mimeType)` keeps working for all four routes; diarization is opt-in through a fourth options argument.
- Every failure degrades, never blocks: missing binary, old OS, missing model, unreadable audio → whisper. Diarization failure alone → transcript with no speakers.
- Live copilot chunks stay speaker-less. Diarization needs the whole file.
- Imported and recorded transcripts must segment identically — both go through `mergeSameSpeaker` from `transcript-import.ts`.
- Tests are `node --test` + `node:assert/strict` under `src/lib/**/*.test.ts`, relative imports, no database, no network, no binary.
- Run `npm test`, `npx tsc --noEmit`, and `npm run lint` before each commit.

## Deviation from the spec, and why

The spec puts the word→speaker alignment inside the Swift CLI (§10.2) and has the binary print the exact JSON the Python service returns. This plan moves the alignment to TypeScript: `mac-speech` prints `{ language, text, words, speakerSpans }`, and `src/lib/mac-speech.ts` assigns speakers by word midpoint, groups contiguous same-speaker words into segments, and runs them through `mergeSameSpeaker`.

Two reasons. The grouping helper the spec insists on reusing already lives in TypeScript, so aligning in Swift would mean either reimplementing it there or handing back segments that the Node side re-splits. And the repo's test suite is `node --test`; alignment in TypeScript gets the boundary cases (a word straddling a handover, a word covered by no span, an empty span list) under test without adding a Swift test target for one function.

The binary's contract stays narrow either way: audio path in, one JSON object out, non-zero exit and a message on stderr for anything it cannot do.

## Tasks

### Task 1 — The `mac-speech` binary
- `mac-speech/Package.swift` — executable target, macOS 26 platform floor, FluidAudio as the only dependency.
- `mac-speech/Sources/mac-speech/main.swift` — argument parsing by hand (`<audio-path> [--hotwords <string>] [--locale <bcp47>] [--diarize] [--prefetch]`), no argument-parser dependency for four flags.
- Transcription: `SpeechTranscriber(locale:transcriptionOptions:reportingOptions:attributeOptions:)` with `.audioTimeRange` and `.transcriptionConfidence`; hotwords into `AnalysisContext.contextualStrings[.general]`; `SpeechAnalyzer(inputAudioFile:modules:analysisContext:finishAfterFile:)`; results consumed from a task started *before* `analyzeSequence`, then `finalizeAndFinish(through:)`.
- Words come from the `AttributedString` runs of final results: run text plus `audioTimeRange` start/end and `transcriptionConfidence` as `probability`.
- Locale: `supportedLocale(equivalentTo:)`, then `AssetInventory.assetInstallationRequest(supporting:)` and `downloadAndInstall()` when the asset is missing. Progress goes to stderr so stdout stays parseable JSON.
- Diarization behind `--diarize`: FluidAudio's offline diarizer over the same file, spans as `{ start, end, speakerId }`. Wrapped so a model or CoreML failure prints a warning to stderr and yields an empty span list rather than failing the run.
- `--prefetch` installs the locale asset and the diarizer models and exits — that is what `setup.sh` calls so the first real recording does not hang for minutes.

### Task 2 — The dispatcher and the Apple provider
- `src/lib/transcribe.ts` — `transcribeAudio(buffer, filename, mimeType, options?)`, provider from `TRANSCRIBE_PROVIDER` (default `whisper`), falling back to whisper on any apple-path failure with the reason logged once.
- `src/lib/mac-speech.ts` — writes the buffer to a temp file, converts to 16 kHz mono wav with ffmpeg when the container is one AVFoundation cannot open (`webm`, `ogg`, `mkv`), spawns the binary, parses stdout, always cleans up the temp files.
- Pure and tested in `src/lib/mac-speech.test.ts`: `speakerForMidpoint`, `assignSpeakers`, `wordsToSegments`, and `needsConversion`.
- `macSpeechResultSchema` in `validation.ts` — the binary's stdout is a trust boundary like any other.
- Binary path resolution: `MAC_SPEECH_BIN` if set, else `mac-speech/.build/release/mac-speech`. Missing file is a fallback, not an error.

### Task 3 — Call sites and setup
- The four routes import from `@/lib/transcribe` instead of `@/lib/whisper-client`; `POST /api/pages/[id]/transcribe` passes `{ diarize: true }`, the three live/short paths do not.
- `Transcript.modelUsed` records which provider actually ran, so a fallback is visible after the fact rather than invisible.
- `scripts/setup.sh` — build `mac-speech` when the platform allows and the sources are newer than the binary; prefetch models; say plainly when it skipped and why. The existing ffmpeg warning gains the webm detail.
- `.env.example` — `TRANSCRIBE_PROVIDER`, `TRANSCRIBE_LOCALE`, `MAC_SPEECH_BIN`, each with what it costs to get wrong.

### Task 4 — Verification
- `npm test`, `npx tsc --noEmit`, `npm run lint`.
- `swift build -c release` in `mac-speech`, then the binary against a real recording: word timings present, speakers assigned, JSON parses.
- Whisper still transcribes with `TRANSCRIBE_PROVIDER` unset.
- `MAC_SPEECH_BIN=/nonexistent` with `TRANSCRIBE_PROVIDER=apple` still produces a transcript.

## Out of scope

- A speaker rename UI. `TranscriptSegment.speaker` is free text and labels are anonymous (`Speaker 1`); renaming is a later, trivial addition.
- Diarization for live copilot chunks — it needs the whole file.
- Mapping a transcript chunk back to a timestamp for deep links (deferred in Phase 2 and still deferred).
- Replacing the Python whisper service. It stays as the cross-platform path and the fallback.
