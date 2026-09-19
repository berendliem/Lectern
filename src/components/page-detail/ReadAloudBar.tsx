"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play, SkipBack, SkipForward, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { sentenceAt, splitIntoSentences, type Sentence } from "@/lib/read-aloud";
import {
  browserVoices,
  DEFAULT_VOICE,
  getKokoroState,
  getServerKokoroState,
  isKokoroVoice,
  KOKORO_VOICES,
  loadKokoro,
  pauseSpeech,
  resumeSpeech,
  say,
  setVolume,
  silence,
  speechSupported,
  subscribeBrowserVoices,
  subscribeKokoro,
  voiceKey,
} from "@/lib/speech";

/**
 * Reads the notes aloud, one sentence at a time, highlighting the sentence
 * being spoken.
 *
 * The voice comes from speech.ts (Kokoro, or one of the browser's own voices
 * picked from the same menu); the rest is platform APIs: Intl.Segmenter for the sentence
 * boundaries (in read-aloud.ts), and the CSS Custom Highlight API for the
 * follow-along. The highlight matters most — it paints over a Range without
 * touching the DOM, so react-markdown's output is never wrapped in marker spans
 * and React never re-renders mid-sentence.
 *
 * Sentences are spoken one at a time rather than as one long utterance:
 * Chrome truncates utterances past roughly fifteen seconds, Kokoro renders a
 * sentence far sooner than a page, and per-sentence playback is also what
 * gives the highlight something to advance on.
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

export function readPrefs(): { voiceId: string; rate: number; volume: number } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { voiceId?: unknown; rate?: unknown; volume?: unknown };
      return {
        // A browser voice is checked against the list once it has loaded, not here.
        voiceId: typeof saved.voiceId === "string" ? saved.voiceId : DEFAULT_VOICE,
        // Off-menu rates reach the voice but leave the picker blank, so
        // a hand-edited or stale value falls back rather than showing through.
        rate: typeof saved.rate === "number" && RATES.includes(saved.rate) ? saved.rate : 1,
        volume: typeof saved.volume === "number" ? Math.max(0, Math.min(1, saved.volume)) : 1,
      };
    }
  } catch {
    // No storage (server render, private mode) or a corrupt value: use defaults.
  }
  return { voiceId: DEFAULT_VOICE, rate: 1, volume: 1 };
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
  const supported = useSyncExternalStore(noSubscription, speechSupported, () => false);
  const lang = useSyncExternalStore(
    noSubscription,
    () => document.documentElement.lang || navigator.language || "en",
    () => "en"
  );
  const kokoro = useSyncExternalStore(subscribeKokoro, getKokoroState, getServerKokoroState);

  const initialPrefs = useState(readPrefs)[0];
  const [voiceId, setVoiceId] = useState(initialPrefs.voiceId);
  const [rate, setRate] = useState(initialPrefs.rate);
  const [volume, setVolumeState] = useState(initialPrefs.volume);
  // getVoices() returns a fresh array each call, so this is state rather than
  // a useSyncExternalStore snapshot.
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () => setVoices(browserVoices(lang));
    load(); // often empty on the first call; voiceschanged fills it in
    return subscribeBrowserVoices(load);
  }, [lang]);
  // A saved browser voice that this machine no longer has falls back to the
  // default rather than to whatever the browser would pick.
  const voice =
    isKokoroVoice(voiceId) || voices.some((v) => voiceKey(v) === voiceId) ? voiceId : DEFAULT_VOICE;
  const localVoices = voices.filter((v) => v.localService);
  const networkVoices = voices.filter((v) => !v.localService);
  const [status, setStatus] = useState<Status>("idle");
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);

  const sentencesRef = useRef<Sentence[]>([]);
  const nodesRef = useRef<Text[]>([]);
  const indexRef = useRef(0);
  const statusRef = useRef<Status>("idle");
  // Bumped on every stop, restart and skip. A reading loop carries the token it
  // started with, so a sentence that settles after a skip cannot carry a stale
  // run on.
  const runRef = useRef(0);
  // Kept current every render so effects can reach the latest closures
  // without listing every value those closures happen to read.
  const speakFromRef = useRef<(i: number) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});
  // A voice or speed picked while paused: the sentence in progress still has
  // the old settings, so resuming has to re-synthesize rather than resume.
  const prefsDirtyRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ voiceId, rate, volume }));
    } catch {
      // Private browsing, quota — the session still works without persistence.
    }
  }, [voiceId, rate, volume]);

  // Applied live: Kokoro through its gain node mid-sentence, the browser voice
  // from the next sentence. Neither needs the sentence restarted.
  useEffect(() => setVolume(volume), [volume]);

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
    silence();
    clearHighlight();
    goto(0);
    setPlaybackStatus("idle");
  }

  function speakFrom(start: number) {
    const sentences = sentencesRef.current;
    if (sentences.length === 0) return;
    const run = ++runRef.current;
    silence();
    // Here rather than in play(), so a Kokoro voice picked mid-reading starts
    // the model too. A browser voice never needs the 326 MB download.
    if (isKokoroVoice(voice)) loadKokoro();
    setPlaybackStatus("playing");

    void (async () => {
      for (let i = Math.max(0, Math.min(start, sentences.length - 1)); i < sentences.length; i++) {
        goto(i);
        showHighlight(i);
        const outcome = await say(sentences[i].text, {
          voice,
          rate,
          lang,
          next: sentences[i + 1]?.text,
        });
        if (run !== runRef.current) return;
        // Stopped by something other than this bar (the recap player), or the
        // voice gave up: either way nothing is reading any more.
        if (outcome !== "ended") break;
      }
      runRef.current++;
      clearHighlight();
      goto(0);
      setPlaybackStatus("idle");
    })();
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
      resumeSpeech();
      setPlaybackStatus("playing");
      return;
    }
    if (build().length === 0) return;
    speakFrom(0);
  }

  function pause() {
    pauseSpeech();
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
  }, [voice, rate]);

  // The notes changed underneath us: the text nodes the ranges point at are gone.
  useEffect(() => {
    if (statusRef.current !== "idle") stopRef.current();
  }, [markdown]);

  useEffect(
    () => () => {
      // The token has to move here too, or a sentence still rendering when the
      // page closes would carry the loop on into a detached tree with no
      // controls left to stop it.
      runRef.current++;
      silence();
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
      // Sticky, so the controls stay in reach while the highlight scrolls the notes.
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-2"
    >
      {/* Painted over a Range, so the notes markup is never touched. The rule lives
          here, not in globals.css, because Lightning CSS does not parse ::highlight()
          yet and warns on every build. */}
      <style href="read-aloud-highlight" precedence="default">
        {`::highlight(${HIGHLIGHT_NAME}) { background-color: var(--read-aloud); }`}
      </style>
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
        {kokoro.status === "loading" && (
          <span className="text-[12.5px] tabular-nums text-muted">
            Downloading voice… {kokoro.progress}%
          </span>
        )}
        {kokoro.status === "failed" && (
          <span className="text-[12.5px] text-muted">Voice unavailable — using the browser&apos;s</span>
        )}
        <select
          value={voice}
          onChange={(e) => setVoiceId(e.target.value)}
          aria-label="Voice"
          className="max-w-[11rem] rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px] text-ink-soft outline-none"
        >
          <optgroup label="Kokoro — runs on this device">
            {KOKORO_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </optgroup>
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
        <label className="flex items-center gap-1.5 text-muted-2" title="Volume">
          <Volume2 className="h-4 w-4" strokeWidth={2.2} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolumeState(Number(e.target.value))}
            aria-label="Volume"
            className="h-1.5 w-20 cursor-pointer appearance-none rounded-full accent-brand"
            style={{
              background: `linear-gradient(to right, var(--color-brand) ${volume * 100}%, var(--line) ${volume * 100}%)`,
            }}
          />
        </label>
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
