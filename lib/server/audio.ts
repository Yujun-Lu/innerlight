import { Buffer } from "node:buffer";
import type { Config } from "./config.ts";
import { ServiceError } from "./errors.ts";
import { postJson, withTimeout } from "./upstream.ts";

export interface PcmAudio { channels: number; sampleRate: number; bits: number; pcm: Uint8Array }
const streamingRiff = new Set([0x7fffffff, 0xffffffff, 0x7fffffbf]);
const streamingData = new Set([0x7fffffff, 0xffffffff]);
const fourcc = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

export function readPcmWav(bytes: Uint8Array): PcmAudio {
  const invalid = () => { throw new ServiceError("INVALID_AUDIO", 422); };
  if (bytes.length < 44 || fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "WAVE") return invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = view.getUint32(4, true);
  if (riff + 8 !== bytes.length && !streamingRiff.has(riff)) return invalid();
  let format: { channels: number; sampleRate: number; bits: number } | undefined;
  let pcm: Uint8Array | undefined;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return invalid();
    const id = fourcc(bytes, offset);
    const declared = view.getUint32(offset + 4, true);
    const start = offset + 8;
    let size = declared;
    const remaining = bytes.length - start;
    if (id === "data" && declared > remaining && (streamingData.has(declared) || (streamingRiff.has(riff) && start + declared === riff + 8))) size = remaining;
    else if (size > remaining) return invalid();
    if (id === "fmt ") {
      if (format || size < 16 || size > 4096) return invalid();
      const encoding = view.getUint16(start, true);
      const channels = view.getUint16(start + 2, true);
      const sampleRate = view.getUint32(start + 4, true);
      const bits = view.getUint16(start + 14, true);
      // PCM extensible is accepted only with the integer PCM subformat GUID.
      const pcmGuid = "0100000000001000800000aa00389b71";
      if (encoding !== 1 && !(encoding === 0xfffe && size >= 40 && Buffer.from(bytes.subarray(start + 24, start + 40)).toString("hex") === pcmGuid)) return invalid();
      if (![1, 2].includes(channels) || ![8000, 16000, 22050, 24000, 44100, 48000, 96000].includes(sampleRate) || ![8, 16, 24, 32].includes(bits)) return invalid();
      const block = channels * bits / 8;
      if (view.getUint16(start + 12, true) !== block || view.getUint32(start + 8, true) !== sampleRate * block) return invalid();
      format = { channels, sampleRate, bits };
    } else if (id === "data") {
      if (!format || pcm || !size || size % (format.channels * format.bits / 8)) return invalid();
      pcm = bytes.subarray(start, start + size);
    }
    offset = start + size;
    if (size % 2 && offset < bytes.length) offset++;
  }
  if (!format || !pcm) return invalid();
  return { ...format, pcm };
}

export function writePcmWav(audio: PcmAudio): Uint8Array {
  const { channels, sampleRate, bits, pcm } = audio;
  const bytes = new Uint8Array(44 + pcm.length + pcm.length % 2);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  put(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); put(8, "WAVE"); put(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * bits / 8, true);
  view.setUint16(32, channels * bits / 8, true); view.setUint16(34, bits, true);
  put(36, "data"); view.setUint32(40, pcm.length, true); bytes.set(pcm, 44);
  return bytes;
}

export function stitchWav(parts: Uint8Array[], pauseSeconds = 1.4): { bytes: Uint8Array; duration: number } {
  if (!parts.length) throw new ServiceError("AUDIO_FAILED", 502);
  const audio = parts.map(readPcmWav);
  const format = audio[0];
  if (audio.some(a => a.channels !== format.channels || a.sampleRate !== format.sampleRate || a.bits !== format.bits)) throw new ServiceError("AUDIO_FAILED", 502);
  const frameBytes = format.channels * format.bits / 8;
  const pauseBytes = Math.round(pauseSeconds * format.sampleRate) * frameBytes;
  const size = audio.reduce((n, a) => n + a.pcm.length, 0) + pauseBytes * (parts.length - 1);
  if (size > 40 * 1024 * 1024) throw new ServiceError("AUDIO_FAILED", 502);
  const pcm = new Uint8Array(size);
  if (format.bits === 8) pcm.fill(128);
  let offset = 0;
  for (const [i, a] of audio.entries()) { pcm.set(a.pcm, offset); offset += a.pcm.length + (i < audio.length - 1 ? pauseBytes : 0); }
  // Combined files get fresh length headers; segment AIGC IDs are not reused.
  return { bytes: writePcmWav({ ...format, pcm }), duration: size / (format.sampleRate * frameBytes) };
}

export function splitScript(script: string, maxLength = 650): string[] {
  const chunks: string[] = [];
  let chunk = "";
  const sentences = script.match(/[^.!?。！？\n]+[.!?。！？]*/g) ?? [];
  for (let sentence of sentences) {
    sentence = sentence.trim();
    if (!sentence) continue;
    if (chunk.length + sentence.length + 1 > maxLength && chunk) { chunks.push(chunk); chunk = ""; }
    while (sentence.length > maxLength) {
      const wordBoundary = sentence.lastIndexOf(" ", maxLength);
      const cut = wordBoundary >= maxLength / 2 ? wordBoundary : maxLength;
      chunks.push(sentence.slice(0, cut).trim()); sentence = sentence.slice(cut).trim();
    }
    if (sentence) chunk = chunk ? `${chunk} ${sentence}` : sentence;
  }
  if (chunk) chunks.push(chunk);
  if (!chunks.length || chunks.length > 5) throw new ServiceError("INVALID_INPUT");
  return chunks;
}

export function ttsPayload(text: string, model = "qwen-audio-3.1-tts-next") {
  return { model, input: {
    text_prompt: `Generate clean, single-speaker English narration for a gentle self-compassion meditation. No background music or sound effects. A warm, low-pitched adult male voice, speaking natural, fluent English. Slow, steady, reassuring delivery, with comfortable pauses between short sentences. Quiet sentence endings, no announcer voice and no dramatic acting. Do not impersonate a real person. Read every word of the following English text exactly; do not read these instructions or add any words.\nNarration: "${text.replace(/[“”]/g, '"')}"`,
    format: "wav", sample_rate: 24000, channels: 1, volume: 50, rate: 0.88, seed: 42, enable_aigc_tag: true,
  } };
}

async function downloadAudio(urlValue: unknown, signal: AbortSignal): Promise<Uint8Array> {
  if (typeof urlValue !== "string") throw new ServiceError("AUDIO_FAILED", 502);
  let url: URL;
  try { url = new URL(urlValue); } catch { throw new ServiceError("AUDIO_FAILED", 502); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !/(?:^|\.)aliyuncs\.com$/.test(url.hostname)) throw new ServiceError("AUDIO_FAILED", 502);
  // The provider sometimes signs an HTTP OSS URL. Upgrade only this validated
  // Alibaba hostname to HTTPS; never download audio over plaintext HTTP.
  if (url.protocol === "http:") url.protocol = "https:";
  const response = await fetch(url, { signal, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) throw new ServiceError("AUDIO_FAILED", 502);
  if (!response.ok || !response.body) throw new ServiceError("AUDIO_FAILED", 502);
  const limit = 15 * 1024 * 1024;
  if (Number(response.headers.get("content-length") ?? 0) > limit) throw new ServiceError("AUDIO_FAILED", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new ServiceError("AUDIO_FAILED", 502); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function synthesize(script: string, config: Config, requestSignal: AbortSignal): Promise<{ bytes: Uint8Array; duration: number; segments: number }> {
  if (!config.audio) throw new ServiceError("NOT_CONFIGURED", 503);
  const chunks = splitScript(script);
  return withTimeout(requestSignal, 300000, async (signal) => {
    const results: Uint8Array[] = [];
    // Two requests at a time, then download and release each provider response.
    for (let i = 0; i < chunks.length; i += 2) {
      const batch = await Promise.all(chunks.slice(i, i + 2).map(async (chunk, offset) => {
        if (offset) await new Promise<void>(resolve => setTimeout(resolve, 600));
        if (signal.aborted) throw new ServiceError("CANCELLED", 499);
        const result = await postJson(config.ttsUrl, config.ttsKey, ttsPayload(chunk, config.ttsModel), signal);
        return downloadAudio(result.output?.audio?.url, signal);
      }));
      results.push(...batch);
    }
    return { ...stitchWav(results), segments: results.length };
  });
}
