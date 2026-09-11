"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { sentenceAt, splitIntoSentences, type Sentence } from "@/lib/read-aloud";

/**
 * Reads the notes aloud, one sentence at a time, highlighting the sentence
 * being spoken.
 *
 * Three platform APIs and no dependency: speechSynthesis for the voice,
 * Intl.Segmenter for the sentence boundaries (in read-aloud.ts), and the CSS
 * Custom Highlight API for the follow-along. The highlight matters most — it
 * paints over a Range without touching the DOM, so react-markdown's output is
 * never wrapped in marker spans and React never re-renders mid-sentence.
 *
 * Sentences are spoken as separate utterances rather than one long one:
 * Chrome truncates utterances past roughly fifteen seconds, and per-sentence
 * playback is also what gives the highlight something to advance on.
 */

const HIGHLIGHT_NAME = "read-aloud";
const PREFS_KEY = "lectern.readAloud";
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Everything react-markdown can emit that ends a sentence by itself. */
const BLOCK_SELECTOR =
  "p,li,h1,h2,h3,h4,h5,h6,td,th,caption,blockquote,pre,figcaption,dt,dd";

type Status = "idle" | "playing" | "paused";

type HighlightRegistry = { set(name: string, value: object): void; delete(name: string): void };

// The Highlight API is newer than the TypeScript DOM lib this project builds
// against, so it is reached for through narrow casts rather than globals.
function highlightRegistry(): HighlightRegistry | undefined {
  return (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
}

function highlightCtor(): (new (...ranges: Range[]) => object) | undefined {
  return (window as unknown as { Highlight?: new (...ranges: Range[]) => object }).Highlight;
}

/** Neither of the two facts below changes after load, so there is nothing to subscribe to. */
const noSubscription = () => () => {};

/**
 * voiceURI is not unique: macOS ships Samantha and Hubert both claiming
 * "Samantha", so selecting one by URI alone hands back whichever comes first.
 * Name and language together separate them.
 */
function voiceKey(voice: SpeechSynthesisVoice): string {
  return `${voice.name}|${voice.lang}|${voice.voiceURI}`;
}

function readPrefs(): { voiceId: string | null; rate: number } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { voiceId?: string; rate?: number };
      return {
        voiceId: typeof saved.voiceId === "string" ? saved.voiceId : null,
        // Off-menu rates reach speechSynthesis but leave the picker blank, so
        // a hand-edited or stale value falls back rather than showing through.
        rate: typeof saved.rate === "number" && RATES.includes(saved.rate) ? saved.rate : 1,
      };
    }
  } catch {
    // No storage (server render, private mode) or a corrupt value: use defaults.
  }
  return { voiceId: null, rate: 1 };
}

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  // caretRangeFromPoint is the one Chrome and Safari implement; Firefox has
  // the standardised caretPositionFromPoint.
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
  const position = doc.caretPositionFromPoint?.(x, y);
  return position ? { node: position.offsetNode, offset: position.offset } : null;
}

export function ReadAloudBar({
  proseRef,
  markdown,
}: {
  proseRef: React.RefObject<HTMLDivElement | null>;
  /** Not read directly — a change means the rendered notes moved under us. */
  markdown: string;
}) {
  // Both read the browser, so they render as the server saw them — absent —
  // until hydration, and the bar renders nothing in the meantime.
  const supported = useSyncExternalStore(
    noSubscription,
    () => "speechSynthesis" in window,
    () => false
  );
  const lang = useSyncExternalStore(
    noSubscription,
    () => document.documentElement.lang || navigator.language || "en",
    () => "en"
  );

  const initialPrefs = useState(readPrefs)[0];
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(initialPrefs.voiceId);
  const [rate, setRate] = useState(initialPrefs.rate);
  const [status, setStatus] = useState<Status>("idle");
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);

  const sentencesRef = useRef<Sentence[]>([]);
  const nodesRef = useRef<Text[]>([]);
  const indexRef = useRef(0);
  const statusRef = useRef<Status>("idle");
  // Bumped on every stop, restart and skip. Chained utterances carry the token
  // they started with, so the onend of a cancelled utterance — which some
  // browsers still fire — cannot resume a stale run.
  const runRef = useRef(0);
  // Kept current every render so effects can reach the latest closures
  // without listing every value those closures happen to read.
  const speakFromRef = useRef<(i: number) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});
  // A voice or speed picked while paused: the queued utterances still carry
  // the old settings, so resuming has to re-synthesize rather than resume.
  const prefsDirtyRef = useRef(false);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load(); // often empty on the first call; voiceschanged fills it in
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ voiceId, rate }));
    } catch {
      // Private browsing, quota — the session still works without persistence.
    }
  }, [voiceId, rate]);

  // Split on localService, because the two halves are not interchangeable: a
  // network voice synthesizes by sending the sentence to the browser vendor's
  // service. Transcription in this app is on-device by design, and reading the
  // notes back should not be the step that puts a lecture on someone's server.
  const { localVoices, networkVoices } = useMemo(() => {
    const prefix = lang.slice(0, 2).toLowerCase();
    const matching = voices.filter((v) => v.lang.slice(0, 2).toLowerCase() === prefix);
    const list = matching.length > 0 ? matching : voices;
    // Collapse true duplicates — same name, language and URI is the same voice
    // listed twice, and two identical options are only a confusing choice.
    const unique = [...new Map(list.map((v) => [voiceKey(v), v])).values()];
    return {
      localVoices: unique.filter((v) => v.localService),
      networkVoices: unique.filter((v) => !v.localService),
    };
  }, [voices, lang]);

  function clearHighlight() {
    highlightRegistry()?.delete(HIGHLIGHT_NAME);
  }

  function showHighlight(i: number) {
    const registry = highlightRegistry();
    const Ctor = highlightCtor();
    if (!registry || !Ctor) return; // speaks fine, just without the follow-along
    const sentence = sentencesRef.current[i];
    const nodes = nodesRef.current;
    const startNode = nodes[sentence?.startPiece ?? -1];
    const endNode = nodes[sentence?.endPiece ?? -1];
    if (!sentence || !startNode || !endNode) return;
    const range = document.createRange();
    range.setStart(startNode, sentence.startOffset);
    range.setEnd(endNode, sentence.endOffset);
    registry.set(HIGHLIGHT_NAME, new Ctor(range));

    // A highlight below the fold tracks nothing the reader can see.
    const rect = range.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      startNode.parentElement?.scrollIntoView({
        block: "center",
        behavior: reduced ? "auto" : "smooth",
      });
    }
  }

  /** Re-read the rendered notes. Cheap, and always current after an edit. */
  function build(): Sentence[] {
    const root = proseRef.current;
    if (!root) return [];
    // Speak what a screen reader would. KaTeX renders each formula twice, as
    // MathML for assistive tech and as aria-hidden HTML for the eye, and keeps
    // the raw TeX in an <annotation>; reading all three says every formula
    // three times over.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, (node) =>
      node.parentElement?.closest('[aria-hidden="true"], annotation')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    );
    const nodes: Text[] = [];
    // Where a new block begins. React renders no whitespace between elements,
    // so without this the last word of one list item and the first of the next
    // read as a single sentence.
    const blockStarts = new Set<number>();
    let previousBlock: Element | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const block = (node.parentElement?.closest(BLOCK_SELECTOR) ?? root) as Element;
      if (previousBlock && block !== previousBlock) blockStarts.add(nodes.length);
      previousBlock = block;
      nodes.push(node as Text);
    }
    nodesRef.current = nodes;
    const sentences = splitIntoSentences(
      nodes.map((n) => n.data),
      lang,
      blockStarts
    );
    sentencesRef.current = sentences;
    setTotal(sentences.length);
    return sentences;
  }

  function goto(i: number) {
    indexRef.current = i;
    setIndex(i);
  }

  function setPlaybackStatus(next: Status) {
    statusRef.current = next;
    setStatus(next);
  }

  function stop() {
    runRef.current++;
    window.speechSynthesis.cancel();
    clearHighlight();
    goto(0);
    setPlaybackStatus("idle");
  }

  function speakFrom(start: number) {
    const sentences = sentencesRef.current;
    if (sentences.length === 0) return;
    const run = ++runRef.current;
    window.speechSynthesis.cancel();
    // The engine keeps its paused flag across a cancel, which would leave the
    // new utterance queued and silent. Resuming an engine that is not paused
    // does nothing, so this is unconditional.
    window.speechSynthesis.resume();
    // No stored choice falls back to an on-device voice rather than to the
    // browser's default, which on Chrome can be a network one.
    const voice = voices.find((v) => voiceKey(v) === voiceId) ?? localVoices[0];

    const speakAt = (i: number) => {
      if (run !== runRef.current) return;
      if (i >= sentences.length) {
        clearHighlight();
        goto(0);
        setPlaybackStatus("idle");
        return;
      }
      goto(i);
      showHighlight(i);
      const utterance = new SpeechSynthesisUtterance(sentences[i].text);
      utterance.rate = rate;
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? lang;
      utterance.onend = () => speakAt(i + 1);
      utterance.onerror = (event) => {
        // Guarded like speakAt: an error from a run the user has already
        // skipped past must not bump the token the live run is holding.
        if (run !== runRef.current) return;
        // "interrupted"/"canceled" are our own cancel() landing, not failures.
        if (event.error !== "interrupted" && event.error !== "canceled") {
          runRef.current++;
          clearHighlight();
          setPlaybackStatus("idle");
        }
      };
      window.speechSynthesis.speak(utterance);
    };

    setPlaybackStatus("playing");
    // Chrome drops a speak() issued in the same tick as a cancel().
    setTimeout(() => speakAt(Math.max(0, Math.min(start, sentences.length - 1))), 0);
  }

  useEffect(() => {
    speakFromRef.current = speakFrom;
    stopRef.current = stop;
  });

  function play() {
    if (status === "paused") {
      if (prefsDirtyRef.current) {
        prefsDirtyRef.current = false;
        speakFrom(indexRef.current); // picks up the voice and speed now shown
        return;
      }
      window.speechSynthesis.resume();
      setPlaybackStatus("playing");
      return;
    }
    if (build().length === 0) return;
    speakFrom(0);
  }

  function pause() {
    window.speechSynthesis.pause();
    setPlaybackStatus("paused");
  }

  function skip(delta: number) {
    const sentences = sentencesRef.current;
    if (sentences.length === 0) return;
    speakFrom(Math.max(0, Math.min(indexRef.current + delta, sentences.length - 1)));
  }

  // Click a sentence while a reading is underway to carry on from there.
  useEffect(() => {
    const root = proseRef.current;
    if (!root || status === "idle") return;
    const onClick = (event: MouseEvent) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return; // selecting text for the edit box
      const caret = caretFromPoint(event.clientX, event.clientY);
      if (!caret) return;
      const piece = nodesRef.current.indexOf(caret.node as Text);
      if (piece < 0) return;
      const i = sentenceAt(sentencesRef.current, piece, caret.offset);
      if (i >= 0) speakFromRef.current(i);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [status, proseRef]);

  // A new voice or speed applies from the current sentence, not the next one.
  // This reads speakFrom through its ref, which the effect above refreshes —
  // that effect must stay declared before this one, or this goes stale.
  useEffect(() => {
    if (statusRef.current === "playing") speakFromRef.current(indexRef.current);
    else if (statusRef.current === "paused") prefsDirtyRef.current = true;
  }, [voiceId, rate]);

  // The notes changed underneath us: the text nodes the ranges point at are gone.
  useEffect(() => {
    if (statusRef.current !== "idle") stopRef.current();
  }, [markdown]);

  useEffect(
    () => () => {
      // The token has to move here too. speakFrom defers its first utterance
      // by a tick, so unmounting in that window would otherwise leave a
      // deferred speakAt whose guard still passes — speaking into a detached
      // tree with no controls left to stop it.
      runRef.current++;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      highlightRegistry()?.delete(HIGHLIGHT_NAME);
    },
    []
  );

  if (!supported) return null;

  const playing = status === "playing";
  const active = status !== "idle";

  return (
    <div
      role="group"
      aria-label="Read the notes aloud"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/60 p-2"
    >
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={playing ? pause : play}
        aria-label={playing ? "Pause reading the notes" : "Read the notes aloud"}
      >
        {playing ? (
          <Pause className="h-4 w-4" strokeWidth={2.2} />
        ) : (
          <Play className="h-4 w-4" strokeWidth={2.2} />
        )}
        {playing ? "Pause" : status === "paused" ? "Resume" : "Listen"}
      </Button>

      <div className="flex items-center">
        <IconButton
          onClick={() => skip(-1)}
          disabled={!active}
          label="Previous sentence"
          icon={<SkipBack className="h-4 w-4" strokeWidth={2.2} />}
        />
        <IconButton
          onClick={() => skip(1)}
          disabled={!active}
          label="Next sentence"
          icon={<SkipForward className="h-4 w-4" strokeWidth={2.2} />}
        />
        <IconButton
          onClick={stop}
          disabled={!active}
          label="Stop reading"
          icon={<Square className="h-4 w-4" strokeWidth={2.2} />}
        />
      </div>

      {active && total > 0 && (
        // Deliberately not a live region: it changes every sentence, and
        // announcing the count over the notes being read is the opposite of
        // helpful. The spoken sentence is the feedback.
        <span className="text-[12.5px] tabular-nums text-muted">
          {index + 1} / {total}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {localVoices.length + networkVoices.length > 0 && (
          <select
            value={voiceId ?? ""}
            onChange={(e) => setVoiceId(e.target.value || null)}
            aria-label="Voice"
            className="max-w-[11rem] rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px] text-ink-soft outline-none"
          >
            <option value="">On-device default</option>
            {localVoices.length > 0 && (
              <optgroup label="On this device">
                {localVoices.map((v) => (
                  <option key={voiceKey(v)} value={voiceKey(v)}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
            {networkVoices.length > 0 && (
              <optgroup label="Network — sends the notes to the voice provider">
                {networkVoices.map((v) => (
                  <option key={voiceKey(v)} value={voiceKey(v)}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
        <select
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          aria-label="Speed"
          className="rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px] text-ink-soft outline-none"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  label,
  icon,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-lg p-1.5 text-muted-2 transition-colors hover:bg-surface-3 hover:text-ink-soft disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
    >
      {icon}
    </button>
  );
}
