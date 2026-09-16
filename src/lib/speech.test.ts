import { test } from "node:test";
import assert from "node:assert/strict";
import { isKokoroVoice, pickEngine } from "./speech";

test("Kokoro reads once the model is ready, even with a browser voice available", () => {
  assert.equal(pickEngine("ready", true), "kokoro");
  assert.equal(pickEngine("ready", false), "kokoro");
});

test("the browser voice reads while the model loads, has not started, or failed", () => {
  assert.equal(pickEngine("loading", true), "browser");
  assert.equal(pickEngine("idle", true), "browser");
  assert.equal(pickEngine("failed", true), "browser");
});

test("with no browser voice, a loading model is waited for and a failed one reads nothing", () => {
  assert.equal(pickEngine("loading", false), "wait");
  assert.equal(pickEngine("failed", false), "none");
  assert.equal(pickEngine("idle", false), "none");
});

test("a voice saved from the old system-voice picker is not a Kokoro voice", () => {
  assert.equal(isKokoroVoice("af_heart"), true);
  assert.equal(isKokoroVoice("Samantha|en-US|com.apple.voice.compact.en-US.Samantha"), false);
  assert.equal(isKokoroVoice(undefined), false);
});
