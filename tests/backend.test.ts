import assert from "node:assert/strict";
import { test } from "node:test";
import { samples } from "../lib/samples.ts";
import { readPcmWav, splitScript, stitchWav, synthesize, ttsPayload, writePcmWav } from "../lib/server/audio.ts";
import { serverConfig } from "../lib/server/config.ts";
import { errorResponse, readJson, ServiceError } from "../lib/server/errors.ts";
import { runWithRuntimeEnv } from "../lib/server/runtime-env.ts";
import { checkGeneratedText, needsImmediateSupport } from "../lib/server/validation.ts";
import { postJson } from "../lib/server/upstream.ts";
import { POST as reflect } from "../app/api/reflect/route.ts";
import { POST as meditation } from "../app/api/meditation/route.ts";
import { POST as audio } from "../app/api/audio/route.ts";
import { POST as transcribe } from "../app/api/transcribe/route.ts";

const request = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(`https://innerlight.example/api/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://innerlight.example", ...headers }, body: JSON.stringify(body),
});
const sampleInput = (id: keyof typeof samples) => ({ text: samples[id].text, mode: "sample", style: "everyday", scenarioId: id });
const pcmWav = (seconds = 1) => writePcmWav({ channels: 1, sampleRate: 16000, bits: 16, pcm: new Uint8Array(seconds * 16000 * 2) });
const json = async (response: Response): Promise<Record<string, any>> => await response.json() as Record<string, any>;

test("text credentials stay on generic endpoint while TTS uses independently configured credentials", () => {
  const config = serverConfig({ DASHSCOPE_API_KEY: "text-secret", TTS_API_KEY: "audio-secret", SFM_WORKSPACE_ID: "workspace-a" });
  assert.equal(config.textUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.match(config.ttsUrl, /workspace-a\.cn-beijing\.maas\.aliyuncs\.com/);
  assert.equal(config.ttsKey, "audio-secret");
  assert.equal(config.audio, true);
  assert.equal(serverConfig({}).audio, false);
  assert.throws(() => serverConfig({ SFM_WORKSPACE_ID: "../bad" }), ServiceError);
});

test("cross-origin requests are rejected before parsing or provider access", async () => {
  const response = await reflect(request("reflect", sampleInput("giving"), { Origin: "https://unrelated.example" }));
  assert.equal(response.status, 403);
  assert.equal((await json(response)).error.code, "FORBIDDEN");
});

test("actual request bytes are bounded even without a content-length header", async () => {
  await assert.rejects(readJson(request("reflect", { text: "a".repeat(100) }), 20), (error: unknown) => error instanceof ServiceError && error.code === "TOO_LARGE");
});

test("all sample reflections and meditations match their announced scenario", async () => {
  for (const id of Object.keys(samples) as Array<keyof typeof samples>) {
    const r = await reflect(request("reflect", sampleInput(id)));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), samples[id].reflection);
    const response = await meditation(request("meditation", { ...sampleInput(id), ...samples[id].reflection }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), samples[id].meditation);
  }
});

test("sample content edits cannot silently produce an unrelated sample", async () => {
  const r = await reflect(request("reflect", { ...sampleInput("giving"), text: "This is my own story." }));
  assert.equal(r.status, 422);
  assert.equal((await json(r)).error.code, "SAMPLE_CHANGED");
  const m = await meditation(request("meditation", { ...sampleInput("giving"), ...samples.giving.reflection, need: "I want to be heard." }));
  assert.equal(m.status, 422);
});

test("explicit danger switches to real-world support without a provider call", async () => {
  assert.equal(needsImmediateSupport("我现在想自杀"), true);
  assert.equal(needsImmediateSupport("I want to kill myself"), true);
  assert.equal(needsImmediateSupport("I'm going to hurt myself"), true);
  assert.equal(needsImmediateSupport("我不想自杀，只想谈谈难过"), false);
  const r = await reflect(request("reflect", { text: "我现在想自杀", style: "everyday", mode: "live" }));
  const data = await json(r);
  assert.equal(data.supportRequired, true);
  assert.match(data.summary, /someone you trust/);
  assert.equal(/[\u3400-\u9fff]/u.test(data.summary), false);
  const m = await meditation(request("meditation", { text: "我现在想自杀", summary: "I am in distress.", need: "Someone beside me", belief: "I can ask for support.", mode: "live", style: "everyday" }));
  assert.equal(m.status, 422);
  assert.equal((await json(m)).error.code, "SUPPORT_REQUIRED");
});

test("live text output is validated and provider error payloads are not exposed", async (t) => {
  const fakeFetch = t.mock.method(globalThis, "fetch", async () => Response.json({ message: "text-secret and personal user input", code: "InvalidApiKey" }, { status: 401 }));
  const r = await runWithRuntimeEnv({ DASHSCOPE_API_KEY: "text-secret" }, () => reflect(request("reflect", { text: "I feel tired after caring for others.", mode: "live", style: "everyday" })));
  assert.equal(r.status, 502);
  const raw = await r.text();
  assert.equal(raw.includes("text-secret"), false);
  assert.equal(raw.includes("personal user input"), false);
  assert.match(raw, /AUTH_FAILED/);
  fakeFetch.mock.restore();
});

test("live reflection includes only validated response fields", async (t) => {
  const fakeFetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(init?.body as string);
    assert.equal(payload.enable_thinking, false);
    assert.equal(payload.response_format.type, "json_object");
    assert.match(payload.messages[0].content, /English, regardless of the user's input language/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "You have cared for others for a long time, and want to care for your own tiredness, too.", feeling: "A little tired", need: "Rest and companionship", belief: "Do I have to keep giving?", supportRequired: false, hidden: "not returned" }) } }] });
  });
  const r = await runWithRuntimeEnv({ DASHSCOPE_API_KEY: "text-secret" }, () => reflect(request("reflect", { text: "我照顾别人很久，有些累了", mode: "live", style: "everyday" })));
  const data = await json(r);
  assert.equal(r.status, 200);
  assert.equal(data.source, "live");
  assert.equal(data.hidden, undefined);
  fakeFetch.mock.restore();
});

test("malformed or omitted model safety flags fail closed", async (t) => {
  for (const flag of [undefined, "true", "false", null, 0]) {
    const fakeFetch = t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      ...samples.giving.reflection, supportRequired: flag,
    }) } }] }));
    const response = await runWithRuntimeEnv({ DASHSCOPE_API_KEY: "text-secret" }, () => reflect(request("reflect", { text: "I feel tired after helping my friend.", mode: "live", style: "everyday" })));
    assert.equal(response.status, 502);
    assert.equal((await json(response)).error.code, "INVALID_OUTPUT");
    fakeFetch.mock.restore();
  }
});

test("a user can skip a suggested belief in a live reflection without the model assigning one", async (t) => {
  const fakeFetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(init?.body as string);
    assert.match(payload.messages[0].content, /do not invent or assign one/);
    assert.equal(JSON.parse(payload.messages[1].content).expectationToLoosen, "");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(samples.giving.meditation) } }] });
  });
  const response = await runWithRuntimeEnv({ DASHSCOPE_API_KEY: "text-secret" }, () => meditation(request("meditation", {
    text: "I need rest after a long evening helping a friend.", mode: "live", style: "everyday",
    summary: samples.giving.reflection.summary, need: "A quiet evening", belief: "",
  })));
  assert.equal(response.status, 200);
  assert.equal((await json(response)).source, "live");
  fakeFetch.mock.restore();
  const sample = await meditation(request("meditation", { ...sampleInput("giving"), ...samples.giving.reflection, belief: "" }));
  assert.equal(sample.status, 422);
});

test("WAV streaming placeholders are repaired and parts are stitched without losing PCM", () => {
  const first = pcmWav();
  new DataView(first.buffer).setUint32(4, 0xffffffff, true);
  new DataView(first.buffer).setUint32(40, 0xffffffff, true);
  assert.equal(readPcmWav(first).pcm.length, 32000);
  const result = stitchWav([first, pcmWav()], 0.5);
  assert.equal(result.duration, 2.5);
  assert.equal(readPcmWav(result.bytes).pcm.length, 80000);
  assert.equal(new DataView(result.bytes.buffer).getUint32(4, true), result.bytes.length - 8);
  const truncated = pcmWav().subarray(0, 100);
  assert.throws(() => readPcmWav(truncated), ServiceError);
});

test("TTS chunks keep all spoken text and requests put audio parameters inside input", () => {
  const script = samples.giving.meditation.script;
  const chunks = splitScript(script);
  assert.equal(chunks.join("").replace(/\s/g, ""), script.replace(/\s/g, ""));
  assert.ok(chunks.every(c => c.length <= 650));
  const payload = ttsPayload(chunks[0]);
  assert.equal(payload.model, "qwen-audio-3.1-tts-next");
  assert.equal(payload.input.format, "wav");
  assert.equal(payload.input.sample_rate, 24000);
  assert.equal(payload.input.seed, 42);
  assert.match(payload.input.text_prompt, /natural, fluent English/);
  assert.equal(/[\u3400-\u9fff]/u.test(payload.input.text_prompt), false);
});

test("sample audio redirects with GET semantics and validates its exact script", async () => {
  const r = await audio(request("audio", { script: samples.giving.meditation.script, mode: "sample", scenarioId: "giving" }));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "https://innerlight.example/audio/giving.wav");
  const modified = await audio(request("audio", { script: "This script has been edited.", mode: "sample", scenarioId: "giving" }));
  assert.equal(modified.status, 422);
});

test("synthesis downloads provider audio without sending the API key to the download host", async (t) => {
  const wav = pcmWav();
  const fakeFetch = t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("SpeechSynthesizer")) return Response.json({ output: { audio: { url: "https://test.oss-cn-beijing.aliyuncs.com/generated.wav" } } });
    assert.equal(init?.headers, undefined);
    return new Response(wav.buffer as ArrayBuffer, { headers: { "Content-Type": "audio/wav" } });
  });
  const result = await synthesize("Take a small moment for yourself.", serverConfig({ DASHSCOPE_API_KEY: "fake", SFM_WORKSPACE_ID: "workspace" }), new AbortController().signal);
  assert.equal(result.duration, 1);
  assert.equal(result.segments, 1);
  fakeFetch.mock.restore();
});

test("ASR rejects invalid audio and accepts a valid bounded PCM recording", async (t) => {
  const invalid = await transcribe(request("transcribe", { audioBase64: "eA==", mimeType: "audio/wav" }));
  assert.equal(invalid.status, 422);
  const fakeFetch = t.mock.method(globalThis, "fetch", async () => Response.json({ output: { text: "I'd like to rest today." } }));
  const r = await runWithRuntimeEnv({ DASHSCOPE_API_KEY: "fake" }, () => transcribe(request("transcribe", { audioBase64: Buffer.from(pcmWav()).toString("base64"), mimeType: "audio/wav" })));
  assert.equal(r.status, 200);
  assert.equal((await json(r)).text, "I'd like to rest today.");
  fakeFetch.mock.restore();
});

test("provider HTTP OSS URLs are upgraded to HTTPS before downloading", async (t) => {
  const wav = pcmWav();
  let downloaded = false;
  const fakeFetch = t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("SpeechSynthesizer")) return Response.json({ output: { audio: { url: "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/generated.wav?signature=fixture" } } });
    assert.equal(String(url), "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/generated.wav?signature=fixture");
    assert.equal(init?.headers, undefined);
    downloaded = true;
    return new Response(wav.buffer as ArrayBuffer);
  });
  const result = await synthesize("Take a small moment for yourself.", serverConfig({ DASHSCOPE_API_KEY: "fake", SFM_WORKSPACE_ID: "workspace" }), new AbortController().signal);
  assert.equal(result.duration, 1);
  assert.equal(downloaded, true);
  fakeFetch.mock.restore();
});

test("untrusted HTTP hosts and URLs containing credentials are rejected before download", async (t) => {
  for (const url of ["http://unknown.example/generated.wav", "http://user:secret@test.aliyuncs.com/generated.wav", "http://test.aliyuncs.com:8080/generated.wav", "http://aliyuncs.com.evil.example/generated.wav"]) {
    let calls = 0;
    const fakeFetch = t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ output: { audio: { url } } }); });
    await assert.rejects(synthesize("Take a small moment for yourself.", serverConfig({ DASHSCOPE_API_KEY: "fake", SFM_WORKSPACE_ID: "workspace" }), new AbortController().signal), (error: unknown) => error instanceof ServiceError && error.code === "AUDIO_FAILED");
    assert.equal(calls, 1);
    fakeFetch.mock.restore();
  }
});

test("unknown errors never leak stack or arbitrary messages", async () => {
  const r = errorResponse(new Error("private material"));
  assert.equal(r.status, 502);
  assert.equal((await r.text()).includes("private material"), false);
});

test("all demo content is English with a short six-paragraph narration", () => {
  for (const sample of Object.values(samples)) {
    assert.equal(/[\u3400-\u9fff]/u.test(JSON.stringify(sample)), false);
    const words = sample.meditation.script.split(/\s+/).length;
    assert.ok(words >= 180 && words <= 240);
    assert.equal(sample.meditation.script.split(/\n\n/).length, 6);
  }
});

test("generated text rejects English false guarantees and non-English output", () => {
  assert.throws(() => checkGeneratedText("The universe guarantees that love will return."), ServiceError);
  assert.throws(() => checkGeneratedText("I will always love you."), ServiceError);
  assert.throws(() => checkGeneratedText("你值得被爱。"), ServiceError);
  assert.doesNotThrow(() => checkGeneratedText("You can care for yourself and ask for support."));
});

test("provider POST requests use manual redirects and never forward keys to a redirect target", async (t) => {
  let calls = 0;
  const fakeFetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://untrusted.example" } });
  });
  await assert.rejects(postJson("https://dashscope.aliyuncs.com/api", "fake", {}, new AbortController().signal), (error: unknown) => error instanceof ServiceError && error.code === "NETWORK_ERROR");
  assert.equal(calls, 1);
  fakeFetch.mock.restore();
});

test("audio downloads use manual redirects and refuse a redirect response", async (t) => {
  let calls = 0;
  const fakeFetch = t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    if (String(url).includes("SpeechSynthesizer")) return Response.json({ output: { audio: { url: "https://test.aliyuncs.com/generated.wav" } } });
    return new Response(null, { status: 303, headers: { Location: "https://untrusted.example" } });
  });
  await assert.rejects(synthesize("Take a small moment for yourself.", serverConfig({ DASHSCOPE_API_KEY: "fake", SFM_WORKSPACE_ID: "workspace" }), new AbortController().signal), (error: unknown) => error instanceof ServiceError && error.code === "AUDIO_FAILED");
  assert.equal(calls, 2);
  fakeFetch.mock.restore();
});
