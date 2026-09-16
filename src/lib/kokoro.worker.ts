import { KokoroTTS } from "kokoro-js";
import type { WorkerMessage, WorkerRequest } from "./speech";

/**
 * Runs Kokoro off the main thread: synthesizing a sentence takes long enough
 * that doing it on the page would freeze scrolling and the controls.
 */

function post(message: WorkerMessage, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

// WebGPU is newer than the TypeScript DOM lib this project builds against.
type GpuNavigator = { gpu?: { requestAdapter(): Promise<unknown> } };

/**
 * WebGPU or nothing. The wasm build runs single-threaded here — multithreaded
 * wasm needs cross-origin isolation, which the app does not have — and measured
 * slower than real time (9.6 s to render 6.7 s of speech), so every sentence
 * would end in a gap. On WebGPU the same model renders a 4.5 s sentence in
 * 0.6 s. Without it the browser voice is the better experience.
 */
async function load() {
  const adapter = await (navigator as unknown as GpuNavigator).gpu?.requestAdapter();
  if (!adapter) throw new Error("WebGPU is not available");
  // fp32 is the precision Kokoro supports on WebGPU: a 326 MB download, cached after the first.
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "fp32",
    device: "webgpu",
    progress_callback: (info) => {
      // The tokenizer and config are a few kilobytes; the .onnx file is the download.
      if (info.status === "progress" && info.file.endsWith(".onnx")) {
        post({ type: "progress", progress: info.progress });
      }
    },
  });
  // The first sentence after loading takes several seconds longer than the rest.
  // Paying that on a throwaway word before announcing "ready" leaves it to the
  // browser voice, instead of a silent gap mid-reading.
  await tts.generate("Ready.");
  return tts;
}

const model = load();

model.then(
  () => post({ type: "ready" }),
  () => post({ type: "failed" })
);

// One inference session cannot run two sentences at once, so requests queue.
let queue: Promise<unknown> = model;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, text, voice, speed } = event.data;
  queue = queue
    .catch(() => {})
    .then(async () => {
      try {
        const tts = await model;
        const audio = await tts.generate(text, { voice, speed });
        post({ type: "audio", id, samples: audio.audio, sampleRate: audio.sampling_rate }, [audio.audio.buffer]);
      } catch {
        post({ type: "error", id });
      }
    });
};
