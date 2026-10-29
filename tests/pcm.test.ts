import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { startRecording } from "../lib/client-audio.ts";
import { encodePcm16Wav, MAX_RECORDING_SECONDS, measurePcm, prepareRecording, resampleMono } from "../lib/pcm.ts";
import { readPcmWav } from "../lib/server/audio.ts";

function sine(rate: number, seconds: number, frequency = 1000, amplitude = 0.5): Float32Array {
  return Float32Array.from({ length: Math.floor(rate * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
}

test("48 kHz speech-band conversion preserves duration and amplitude", () => {
  const output = resampleMono(sine(48000, 0.1), 48000);
  assert.equal(output.length, 1600);
  assert.ok(Math.abs(measurePcm(output.subarray(100, -100)).rms - Math.SQRT1_2 * 0.5) < 0.005);
});

test("downsampling rejects a 12 kHz tone rather than aliasing it into 4 kHz", () => {
  const output = resampleMono(sine(48000, 0.1, 12000), 48000);
  assert.ok(measurePcm(output.subarray(100, -100)).rms < 0.01);
});

test("fractional 44.1 kHz conversion preserves the expected waveform and sample count", () => {
  const output = resampleMono(sine(44100, 0.1), 44100);
  assert.equal(output.length, 1600);
  let error = 0;
  for (let i = 100; i < output.length - 100; i++) error += Math.abs(output[i] - 0.5 * Math.sin(2 * Math.PI * 1000 * i / 16000));
  assert.ok(error / 1400 < 0.003);
});

test("conversion preserves DC and can upsample an 8 kHz source without zero gaps", () => {
  const dc = resampleMono(new Float32Array(441).fill(0.3), 44100);
  assert.ok(dc.every(value => Math.abs(value - 0.3) < 0.00001));
  const output = resampleMono(sine(8000, 0.1, 500), 8000);
  assert.equal(output.length, 1600);
  assert.ok(Math.abs(measurePcm(output.subarray(100, -100)).rms - Math.SQRT1_2 * 0.5) < 0.01);
});

test("PCM16 encoding clamps overloads and sanitizes non-finite samples", () => {
  const samples = new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, NaN, Infinity]);
  const buffer = encodePcm16Wav(samples);
  const view = new DataView(buffer);
  assert.deepEqual(Array.from({ length: samples.length }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0, 0]);
  const decoded = readPcmWav(new Uint8Array(buffer));
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.sampleRate, 16000);
  assert.equal(decoded.bits, 16);
  assert.equal(decoded.pcm.length, samples.length * 2);
  assert.equal(view.getUint32(4, true), buffer.byteLength - 8);
});

test("assembler rejects short and silent recordings while accepting quiet speech", () => {
  assert.throws(() => prepareRecording([sine(16000, 0.3)], 16000), /little short/);
  assert.throws(() => prepareRecording([new Float32Array(16000)], 16000), /enough sound/);
  assert.throws(() => prepareRecording([new Float32Array(16000).fill(0.00001)], 16000), /enough sound/);
  assert.doesNotThrow(() => prepareRecording([sine(16000, 0.5, 500, 0.005)], 16000));
  assert.throws(() => resampleMono(new Float32Array(10), NaN), /sample rate/);
});

test("assembler caps accepted samples at exactly 45 seconds independent of wall timers", () => {
  const buffer = prepareRecording([new Float32Array(16000 * 44).fill(0.2), new Float32Array(16000 * 4).fill(0.4)], 16000);
  const decoded = readPcmWav(new Uint8Array(buffer));
  assert.equal(decoded.pcm.length / 32000, MAX_RECORDING_SECONDS);
  const view = new DataView(buffer);
  assert.equal(view.getInt16(44, true), Math.round(0.2 * 32767));
  assert.equal(view.getInt16(buffer.byteLength - 2, true), Math.round(0.4 * 32767));
});

function workletHarness(rate = 48000) {
  const messages: Array<{ type: string; samples?: Float32Array }> = [];
  let Processor: any;
  class BaseProcessor {
    port = { onmessage: null as null | ((event: any) => void), postMessage: (message: any) => messages.push(message) };
  }
  runInNewContext(readFileSync(new URL("../public/recording-worklet.js", import.meta.url), "utf8"), {
    AudioWorkletProcessor: BaseProcessor, sampleRate: rate, Float32Array,
    registerProcessor: (name: string, value: any) => { assert.equal(name, "innerlight-recorder"); Processor = value; },
  });
  return { processor: new Processor(), messages };
}

test("actual worklet averages channels, handles variable block sizes, and flushes its final partial buffer", () => {
  const { processor, messages } = workletHarness();
  const output = [new Float32Array(3).fill(1)];
  processor.process([[new Float32Array(3).fill(0.2), new Float32Array(3).fill(0.6)]], [output]);
  processor.process([[new Float32Array(5).fill(0.1)]], [[new Float32Array(5)]]);
  assert.ok(output[0].every(value => value === 0));
  assert.equal(messages.length, 0);
  processor.port.onmessage({ data: { type: "stop" } });
  assert.equal(messages[0].samples?.length, 8);
  assert.ok(Math.abs(messages[0].samples![0] - 0.4) < 0.00001);
  assert.equal(messages[1].type, "stopped");
});

test("actual worklet stops producing samples at its 45-second frame limit", () => {
  const { processor, messages } = workletHarness(16000);
  const input = new Float32Array(8192).fill(0.2);
  for (let i = 0; i < 100; i++) processor.process([[input]], [[new Float32Array(input.length)]]);
  const received = messages.filter(message => message.type === "chunk").reduce((sum, message) => sum + message.samples!.length, 0);
  assert.equal(received, 16000 * 45);
  assert.equal(messages.filter(message => message.type === "limit").length, 1);
});

async function withBrowser<T>(run: (state: { track: any; context: any; worklet: any; failModule: () => void; endDuringResume: () => void }) => Promise<T>, rate = 48000): Promise<T> {
  const names = ["window", "navigator", "AudioContext", "AudioWorkletNode"] as const;
  const descriptors = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const state: any = { moduleFails: false };
  const listeners = new Map<string, Set<() => void>>();
  const track = {
    stopped: 0, readyState: "live",
    stop() { this.stopped++; this.readyState = "ended"; },
    addEventListener(name: string, listener: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(listener); },
    removeEventListener(name: string, listener: () => void) { listeners.get(name)?.delete(listener); },
    emit(name: string) { for (const listener of [...listeners.get(name) ?? []]) listener(); },
  };
  class Node {
    disconnected = 0;
    connect(node: unknown) { return node; }
    disconnect() { this.disconnected++; }
  }
  class Context {
    sampleRate = rate;
    state = "running";
    closed = 0;
    destination = new Node();
    audioWorklet = { addModule: async (url: string) => { assert.equal(url, "/recording-worklet.js"); if (state.moduleFails) throw new Error("failed module"); } };
    constructor() { state.context = this; }
    createMediaStreamSource() { return new Node(); }
    createGain() { return Object.assign(new Node(), { gain: { value: 1 } }); }
    async resume() { if (state.endDuringResume) track.emit("ended"); }
    async close() { this.closed++; this.state = "closed"; }
  }
  class Worklet extends Node {
    onprocessorerror: null | (() => void) = null;
    port = {
      onmessage: null as null | ((event: any) => void),
      postMessage: (message: any) => { if (message.type === "stop") queueMicrotask(() => this.port.onmessage?.({ data: { type: "stopped" } })); },
      close() {},
    };
    constructor() { super(); state.worklet = this; }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { AudioContext: Context } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } } });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: Context });
  Object.defineProperty(globalThis, "AudioWorkletNode", { configurable: true, value: Worklet });
  try { return await run({ track, get context() { return state.context; }, get worklet() { return state.worklet; }, failModule: () => { state.moduleFails = true; }, endDuringResume: () => { state.endDuringResume = true; } }); }
  finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("client capture reports measured RMS, caches stop(), and releases microphone resources once", async () => {
  await withBrowser(async state => {
    const levels: number[] = [];
    const recording = await startRecording({ onLevel: value => levels.push(value) });
    state.worklet.port.onmessage({ data: { type: "chunk", samples: sine(48000, 0.5, 1000, 0.2) } });
    assert.ok(Math.abs(levels[0] - 0.2 * Math.SQRT1_2) < 0.00001);
    const first = recording.stop();
    assert.equal(first, recording.stop());
    const result = await first;
    const wav = readPcmWav(new Uint8Array(Buffer.from(result.audioBase64, "base64")));
    assert.equal(wav.sampleRate, 16000);
    assert.equal(wav.pcm.length, 16000);
    assert.equal(result.mimeType, "audio/wav");
    recording.cancel(); recording.cancel();
    assert.equal(state.track.stopped, 1);
    assert.equal(state.context.closed, 1);
    assert.equal(levels.at(-1), 0);
  });
});

test("client cancel is idempotent and stop after cancel rejects predictably", async () => {
  await withBrowser(async state => {
    const recording = await startRecording();
    recording.cancel(); recording.cancel();
    const result = recording.stop();
    assert.equal(result, recording.stop());
    await assert.rejects(result, /canceled/);
    assert.equal(state.track.stopped, 1);
    assert.equal(state.context.closed, 1);
  });
});

test("worklet initialization failures release the already acquired microphone", async () => {
  await withBrowser(async state => {
    state.failModule();
    await assert.rejects(startRecording(), /couldn't start secure microphone recording/);
    assert.equal(state.track.stopped, 1);
    assert.equal(state.context.closed, 1);
  });
});

test("client frame cap automatically closes capture and notifies the UI only once", async () => {
  await withBrowser(async state => {
    let limits = 0;
    const recording = await startRecording({ onLimit: () => { limits++; } });
    state.worklet.port.onmessage({ data: { type: "chunk", samples: new Float32Array(16000 * 46).fill(0.2) } });
    assert.equal(limits, 1);
    assert.equal(state.track.stopped, 1);
    assert.equal(state.context.closed, 1);
    const result = await recording.stop();
    const wav = readPcmWav(new Uint8Array(Buffer.from(result.audioBase64, "base64")));
    assert.equal(wav.pcm.length / 32000, 45);
    recording.cancel();
    assert.equal(limits, 1);
  }, 16000);
});

test("a disconnected microphone reports one informative error and stop preserves it", async () => {
  await withBrowser(async state => {
    const errors: string[] = [];
    const recording = await startRecording({ onError: message => errors.push(message) });
    state.track.emit("ended");
    state.track.emit("ended");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /microphone disconnected/);
    const result = recording.stop();
    assert.equal(result, recording.stop());
    await assert.rejects(result, /microphone disconnected/);
    recording.cancel();
    assert.equal(state.track.stopped, 1);
    assert.equal(state.context.closed, 1);
  });
});

test("a worklet processor error notifies once even if queued callbacks arrive after cleanup", async () => {
  await withBrowser(async state => {
    const errors: string[] = [];
    const recording = await startRecording({ onError: message => errors.push(message) });
    const queuedError = state.worklet.onprocessorerror;
    queuedError(); queuedError(); state.track.emit("ended");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /recording stopped unexpectedly/);
    await assert.rejects(recording.stop(), /recording stopped unexpectedly/);
    assert.equal(state.track.stopped, 1);
    assert.equal(state.context.closed, 1);
  });
});

test("a microphone interruption during initialization rejects instead of returning dead capture", async () => {
  await withBrowser(async state => {
    state.endDuringResume();
    const errors: string[] = [];
    await assert.rejects(startRecording({ onError: message => errors.push(message) }), /microphone disconnected/);
    assert.equal(errors.length, 1);
    assert.equal(state.track.stopped, 1);
    assert.equal(state.context.closed, 1);
  });
});
