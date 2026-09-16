/**
 * One voice for everything the app reads aloud.
 *
 * The browser's own speechSynthesis voices are mostly the compact system ones
 * and sound robotic. Kokoro-82M is an open-source (Apache-2.0) voice model that
 * runs on the GPU from a Web Worker on the student's machine: the notes never
 * leave it, only the model is downloaded, once, from Hugging Face.
 *
 * The first download is 326 MB, so each sentence picks its engine as it comes
 * up — the browser voice reads while the model loads, and Kokoro takes over
 * from the next sentence once it is ready. The browser voice also covers a
 * browser without WebGPU, a model that fails to load, and a sentence Kokoro
 * cannot synthesize.
 */

export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart (US)" },
  { id: "af_bella", label: "Bella (US)" },
  { id: "af_nicole", label: "Nicole (US)" },
  { id: "am_michael", label: "Michael (US)" },
  { id: "am_fenrir", label: "Fenrir (US)" },
  { id: "bf_emma", label: "Emma (UK)" },
  { id: "bm_george", label: "George (UK)" },
  { id: "bm_fable", label: "Fable (UK)" },
] as const;

export type KokoroVoice = (typeof KOKORO_VOICES)[number]["id"];
export const DEFAULT_VOICE: KokoroVoice = "af_heart";

export function isKokoroVoice(value: unknown): value is KokoroVoice {
  return KOKORO_VOICES.some((v) => v.id === value);
}

export type KokoroStatus = "idle" | "loading" | "ready" | "failed";
export type KokoroState = { status: KokoroStatus; progress: number };

export type WorkerRequest = { id: number; text: string; voice: KokoroVoice; speed: number };
export type WorkerMessage =
  | { type: "progress"; progress: number }
  | { type: "ready" }
  | { type: "failed" }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "error"; id: number };

export type Engine = "kokoro" | "browser" | "wait" | "none";

/** Which engine reads the next sentence. */
export function pickEngine(kokoro: KokoroStatus, hasBrowserVoice: boolean): Engine {
  if (kokoro === "ready") return "kokoro";
  if (hasBrowserVoice) return "browser";
  return kokoro === "loading" ? "wait" : "none";
}

// --- model state, readable through useSyncExternalStore ---------------------

const IDLE: KokoroState = { status: "idle", progress: 0 };
let state: KokoroState = IDLE;
const listeners = new Set<() => void>();

function setState(next: KokoroState) {
  state = next;
  listeners.forEach((listener) => listener());
  wakeWaiters();
}

export function subscribeKokoro(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const getKokoroState = () => state;
export const getServerKokoroState = () => IDLE;

const hasBrowserSpeech = () => typeof window !== "undefined" && "speechSynthesis" in window;
const canRunKokoro = () => typeof Worker !== "undefined" && typeof AudioContext !== "undefined";

export function speechSupported(): boolean {
  return hasBrowserSpeech() || canRunKokoro();
}

/**
 * An on-device voice for the language, never a network one: reading the notes
 * back should not be the step that sends a lecture to the browser vendor's
 * service. No such voice means no browser voice at all — speaking without one
 * would let the browser pick its default, which can be a network voice.
 */
function localVoice(lang: string): SpeechSynthesisVoice | undefined {
  if (!hasBrowserSpeech()) return undefined;
  const prefix = lang.slice(0, 2).toLowerCase();
  return window.speechSynthesis
    .getVoices()
    .find((v) => v.localService && v.lang.slice(0, 2).toLowerCase() === prefix);
}

// Sentences parked until an engine can read them, woken by anything that might
// free one: the model settling, the voice list arriving, or silence().
const waiters = new Set<() => void>();

function wakeWaiters() {
  const woken = [...waiters];
  waiters.clear();
  woken.forEach((wake) => wake());
}

if (hasBrowserSpeech()) {
  // Chrome lists no voices until asked once and voiceschanged fires, so ask on
  // load rather than finding the list empty at the first click.
  window.speechSynthesis.addEventListener("voiceschanged", wakeWaiters);
  window.speechSynthesis.getVoices();
}

// --- the worker --------------------------------------------------------------

let worker: Worker | null = null;
let audioCtx: AudioContext | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (buffer: AudioBuffer) => void; reject: () => void }>();

// ponytail: a skipped sentence's lookahead still runs in the worker before the
// sentence the student skipped to. Cancel queued worker jobs if skipping feels slow.
const rendered = new Map<string, Promise<AudioBuffer>>();

/**
 * Starts the model download and unlocks audio. Call it from the click that
 * starts playback: an AudioContext created outside a user gesture starts
 * suspended. Safe to call on every click.
 */
export function loadKokoro() {
  if (!canRunKokoro()) {
    if (state.status !== "failed") setState({ status: "failed", progress: 0 });
    return;
  }
  audioCtx ??= new AudioContext();
  if (worker) return;

  setState({ status: "loading", progress: 0 });
  worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    switch (message.type) {
      case "progress": {
        // Rounded so a 326 MB download re-renders a hundred times, not thousands.
        const progress = Math.round(message.progress);
        if (state.status === "loading" && progress !== state.progress) setState({ status: "loading", progress });
        break;
      }
      case "ready":
        setState({ status: "ready", progress: 100 });
        break;
      case "failed":
        failKokoro();
        break;
      case "audio": {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (!request || !audioCtx) break;
        const buffer = audioCtx.createBuffer(1, message.samples.length, message.sampleRate);
        buffer.getChannelData(0).set(message.samples);
        request.resolve(buffer);
        break;
      }
      case "error":
        pending.get(message.id)?.reject();
        pending.delete(message.id);
        break;
    }
  };
  worker.onerror = failKokoro;
}

/** The terminated worker stays assigned, so a failed model is not re-downloaded until a reload. */
function failKokoro() {
  worker?.terminate();
  setState({ status: "failed", progress: 0 });
  for (const request of pending.values()) request.reject();
  pending.clear();
  rendered.clear();
}

function render(text: string, voice: KokoroVoice, rate: number): Promise<AudioBuffer> {
  const key = `${voice}|${rate}|${text}`;
  let audio = rendered.get(key);
  if (!audio) {
    audio = new Promise<AudioBuffer>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker?.postMessage({ id, text, voice, speed: rate } satisfies WorkerRequest);
    });
    // A lookahead nobody plays must not surface as an unhandled rejection.
    audio.catch(() => {});
    rendered.set(key, audio);
  }
  return audio;
}

// --- playback ----------------------------------------------------------------

export type Outcome = "ended" | "cancelled" | "failed";

export type SayOptions = {
  voice: KokoroVoice;
  rate: number;
  /** For the browser voice, which has to be told the language. */
  lang: string;
  /** The sentence after this one, rendered in the background so it starts without a gap. */
  next?: string;
};

// Bumped by silence(); a sentence that started under an older generation is cancelled.
let generation = 0;
let source: AudioBufferSourceNode | null = null;
// Held so the browser cannot garbage-collect an utterance mid-sentence.
let utterance: SpeechSynthesisUtterance | null = null;

/** Reads one sentence and settles when it has been read, stopped, or has failed. */
export async function say(text: string, options: SayOptions): Promise<Outcome> {
  const gen = generation;
  let engine = pickEngine(state.status, !!localVoice(options.lang));

  while (engine === "wait") {
    await new Promise<void>((resolve) => waiters.add(resolve));
    if (gen !== generation) return "cancelled";
    engine = pickEngine(state.status, !!localVoice(options.lang));
  }

  if (engine === "kokoro") {
    const audio = render(text, options.voice, options.rate);
    rendered.delete(`${options.voice}|${options.rate}|${text}`);
    if (options.next) render(options.next, options.voice, options.rate);
    try {
      const buffer = await audio;
      if (gen !== generation) return "cancelled";
      return await playBuffer(buffer, gen);
    } catch {
      if (gen !== generation) return "cancelled";
      if (!localVoice(options.lang)) return "failed";
      engine = "browser";
    }
  }

  if (engine === "browser") return speakWithBrowser(text, options, gen);
  return "failed";
}

function playBuffer(buffer: AudioBuffer, gen: number): Promise<Outcome> {
  const ctx = audioCtx;
  if (!ctx) return Promise.resolve("failed");
  return new Promise((resolve) => {
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.onended = () => {
      if (source === node) source = null;
      resolve(gen === generation ? "ended" : "cancelled");
    };
    source = node;
    node.start();
  });
}

function speakWithBrowser(text: string, { rate, lang }: SayOptions, gen: number): Promise<Outcome> {
  return new Promise((resolve) => {
    // Chrome drops a speak() issued in the same tick as a cancel().
    setTimeout(() => {
      if (gen !== generation) return resolve("cancelled");
      const voice = localVoice(lang);
      if (!voice) return resolve("failed");
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.voice = voice;
      u.lang = voice.lang;
      const settle = (outcome: Outcome) => {
        if (utterance === u) utterance = null;
        resolve(gen === generation ? outcome : "cancelled");
      };
      u.onend = () => settle("ended");
      u.onerror = (event) =>
        settle(event.error === "interrupted" || event.error === "canceled" ? "cancelled" : "failed");
      utterance = u;
      window.speechSynthesis.speak(u);
    }, 0);
  });
}

/** Stops whatever is being read, by either engine. */
export function silence() {
  generation++;
  wakeWaiters();
  rendered.clear();
  const node = source;
  source = null;
  node?.stop();
  utterance = null;
  if (hasBrowserSpeech()) {
    window.speechSynthesis.cancel();
    // The engine keeps its paused flag across a cancel, which would leave the
    // next utterance queued and silent. Resuming an unpaused engine does nothing.
    window.speechSynthesis.resume();
  }
  resumeAudio();
}

// Both reject only on a closed AudioContext, which has nothing left to pause or play.
const resumeAudio = () => audioCtx?.resume().catch(() => {});

export function pauseSpeech() {
  audioCtx?.suspend().catch(() => {});
  if (hasBrowserSpeech()) window.speechSynthesis.pause();
}

export function resumeSpeech() {
  resumeAudio();
  if (hasBrowserSpeech()) window.speechSynthesis.resume();
}
