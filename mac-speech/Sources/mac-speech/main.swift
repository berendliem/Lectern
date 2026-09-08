import AVFoundation
import FluidAudio
import Foundation
import Speech

// mac-speech — on-device transcription with speaker spans.
//
// Apple's SpeechTranscriber gives the text, per-word timings, and honours the
// personal dictionary through contextual strings. FluidAudio gives the speaker
// spans. Neither engine does both, so this binary runs both over the same file
// and prints their raw output; the word-to-speaker alignment lives in
// src/lib/mac-speech.ts, next to the tests and to the segment grouping that
// imported transcripts already use.
//
// stdout is exactly one JSON object. Everything else — progress, warnings —
// goes to stderr, so the caller can parse stdout without filtering it.

struct WordOut: Encodable {
    let word: String
    let start: Double
    let end: Double
    let probability: Double
}

struct SpanOut: Encodable {
    let start: Double
    let end: Double
    let speakerId: String
}

struct Output: Encodable {
    let language: String
    let text: String
    let words: [WordOut]
    let speakerSpans: [SpanOut]
}

func note(_ message: String) {
    FileHandle.standardError.write(Data("mac-speech: \(message)\n".utf8))
}

func fail(_ message: String) -> Never {
    note(message)
    exit(1)
}

// --- arguments ---------------------------------------------------------------
// Four flags do not justify a dependency on swift-argument-parser.

var audioPath: String?
var hotwords = ""
var localeIdentifier = "en-US"
var diarize = false
var prefetchOnly = false

var arguments = Array(CommandLine.arguments.dropFirst())
while let argument = arguments.first {
    arguments.removeFirst()
    switch argument {
    case "--hotwords":
        guard let value = arguments.first else { fail("--hotwords needs a value") }
        arguments.removeFirst()
        hotwords = value
    case "--locale":
        guard let value = arguments.first else { fail("--locale needs a value") }
        arguments.removeFirst()
        localeIdentifier = value
    case "--diarize":
        diarize = true
    case "--prefetch":
        prefetchOnly = true
    case "--help", "-h":
        print("usage: mac-speech <audio-path> [--hotwords \"a b c\"] [--locale en-US] [--diarize]")
        print("       mac-speech --prefetch [--locale en-US]")
        exit(0)
    default:
        if argument.hasPrefix("-") { fail("unknown option \(argument)") }
        if audioPath != nil { fail("expected a single audio path") }
        audioPath = argument
    }
}

// --- transcription -----------------------------------------------------------

/// Resolves the locale to one the OS actually ships a model for, and installs
/// that model if it is missing. The first call on a fresh machine downloads;
/// later calls are a no-op.
func makeTranscriber(locale identifier: String) async throws -> (SpeechTranscriber, Locale) {
    guard SpeechTranscriber.isAvailable else {
        throw NSError(
            domain: "mac-speech", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "SpeechTranscriber is unavailable on this machine"])
    }

    let requested = Locale(identifier: identifier)
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
        throw NSError(
            domain: "mac-speech", code: 3,
            userInfo: [NSLocalizedDescriptionKey: "no speech model supports the locale \(identifier)"])
    }

    let transcriber = SpeechTranscriber(
        locale: locale,
        transcriptionOptions: [],
        reportingOptions: [],
        attributeOptions: [.audioTimeRange, .transcriptionConfidence]
    )

    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        note("preparing speech models… (first run only)")
        try await request.downloadAndInstall()
    }

    return (transcriber, locale)
}

/// Every final result, flattened into words. A run of the attributed string is
/// one word when `.audioTimeRange` is on; runs without a time range (spacing,
/// punctuation carried alone) are dropped rather than given a fake span.
func transcribe(path: String, hotwords: String, locale identifier: String) async throws -> (
    language: String, text: String, words: [WordOut]
) {
    let url = URL(fileURLWithPath: path)
    let audioFile = try AVAudioFile(forReading: url)
    let (transcriber, locale) = try await makeTranscriber(locale: identifier)

    let context = AnalysisContext()
    let terms = hotwords.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init)
    if !terms.isEmpty { context.contextualStrings[.general] = terms }

    // The results consumer has to be running before analysis starts, or early
    // results are dropped on the floor.
    let collector = Task {
        var words: [WordOut] = []
        var text = AttributedString()
        for try await result in transcriber.results where result.isFinal {
            text.append(result.text)
            for run in result.text.runs {
                guard let range = run.audioTimeRange else { continue }
                let word = String(result.text[run.range].characters)
                if word.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
                words.append(
                    WordOut(
                        word: word,
                        start: range.start.seconds,
                        end: (range.start + range.duration).seconds,
                        probability: run.transcriptionConfidence ?? 1.0
                    ))
            }
        }
        return (String(text.characters), words)
    }

    // The module-only initializer, not the `inputAudioFile:` convenience one:
    // that convenience already claims the file as the input sequence, and
    // analyzing a second sequence over the same analyzer traps at runtime.
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    try await analyzer.setContext(context)

    if let last = try await analyzer.analyzeSequence(from: audioFile) {
        try await analyzer.finalizeAndFinish(through: last)
    } else {
        try await analyzer.finalizeAndFinishThroughEndOfInput()
    }

    let (text, words) = try await collector.value
    let language = locale.language.languageCode?.identifier ?? locale.identifier(.bcp47)
    return (language, text.trimmingCharacters(in: .whitespacesAndNewlines), words)
}

// --- diarization -------------------------------------------------------------

/// Speaker spans over the same file. A failure here is a warning, never fatal:
/// a transcript with no speaker labels is still the transcript the user asked
/// for, and the caller cannot tell it apart from an unlabelled import.
func speakerSpans(path: String) async -> [SpanOut] {
    do {
        let manager = OfflineDiarizerManager()
        try await manager.prepareModels()
        let result = try await manager.process(URL(fileURLWithPath: path))
        return result.segments.map {
            SpanOut(
                start: Double($0.startTimeSeconds),
                end: Double($0.endTimeSeconds),
                speakerId: $0.speakerId
            )
        }
    } catch {
        note("diarization failed, returning a speaker-less transcript: \(error.localizedDescription)")
        return []
    }
}

// --- run ---------------------------------------------------------------------

if prefetchOnly {
    do {
        _ = try await makeTranscriber(locale: localeIdentifier)
        note("speech model ready for \(localeIdentifier)")
    } catch {
        fail("could not install the speech model: \(error.localizedDescription)")
    }
    do {
        let manager = OfflineDiarizerManager()
        try await manager.prepareModels()
        note("diarizer models ready")
    } catch {
        // Worth saying out loud, but not worth failing setup over: without
        // these models transcription still works, just without speakers.
        note("could not prepare the diarizer models: \(error.localizedDescription)")
    }
    exit(0)
}

guard let path = audioPath else { fail("usage: mac-speech <audio-path> [--diarize]") }
guard FileManager.default.fileExists(atPath: path) else { fail("no such file: \(path)") }

do {
    let (language, text, words) = try await transcribe(
        path: path, hotwords: hotwords, locale: localeIdentifier)
    let spans = diarize ? await speakerSpans(path: path) : []

    let data = try JSONEncoder().encode(
        Output(language: language, text: text, words: words, speakerSpans: spans))
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fail("transcription failed: \(error.localizedDescription)")
}
