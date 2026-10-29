import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionGuard } from "../lib/session-guard.ts";
import { ClientError, requestAudio, requestJson } from "../lib/client-api.ts";

test("double activation cannot create duplicate paid requests", () => {
  const gate = new SessionGuard();
  const first = gate.start()!;
  assert.equal(gate.start(), null);
  assert.equal(gate.valid(first), true);
  assert.equal(gate.finish(first), true);
  assert.ok(gate.start());
});

test("cancel invalidates late results even if a provider ignores abort", async () => {
  const gate = new SessionGuard();
  const first = gate.start()!;
  let resolve!: (value: string) => void;
  const late = new Promise<string>(done => { resolve = done; });
  const state: string[] = [];
  const work = late.then(result => { if (gate.valid(first)) state.push(result); });
  gate.cancel();
  const second = gate.start()!;
  resolve("obsolete meditation"); await work;
  assert.deepEqual(state, []);
  assert.equal(first.signal.aborted, true);
  assert.equal(gate.finish(first), false);
  assert.equal(gate.busy, true);
  assert.equal(gate.valid(second), true);
});

test("repeated resets keep all previous requests invalid", () => {
  const gate = new SessionGuard();
  const original = gate.start()!;
  gate.cancel(); gate.cancel();
  const latest = gate.start()!;
  assert.equal(gate.owns(original), false);
  assert.equal(gate.owns(latest), true);
  assert.equal(gate.finish(latest), true);
  assert.equal(gate.busy, false);
});

test("HTML gateway errors become a readable retry message", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>private diagnostic detail</html>", { status: 502 }));
  await assert.rejects(requestJson("/api/reflect", {}, new AbortController().signal), error => {
    assert.ok(error instanceof ClientError);
    assert.equal(error.message.includes("private diagnostic"), false);
    assert.match(error.message, /try again/);
    return true;
  });
});

test("a truncated successful JSON response cannot be mistaken for a reflection", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response('{"summary":', { status: 200 }));
  await assert.rejects(requestJson("/api/reflect", {}, new AbortController().signal), error => error instanceof ClientError && error.code === "INVALID_RESPONSE");
});

test("timeout rejects a late successful response even when fetch ignores cancellation", async t => {
  t.mock.method(globalThis, "fetch", async () => {
    await new Promise(resolve => setTimeout(resolve, 15));
    return Response.json({ summary: "too late" });
  });
  await assert.rejects(requestJson("/api/reflect", {}, new AbortController().signal, 2), error => error instanceof ClientError && error.code === "TIMEOUT");
});

test("user cancellation propagates instead of presenting a failure", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return Response.json({ summary: "ignored" });
  });
  await assert.rejects(requestJson("/api/reflect", {}, controller.signal), error => error instanceof DOMException && error.name === "AbortError");
});

test("a 200 HTML document cannot enter the audio player as a recording", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>".repeat(30), { headers: { "Content-Type": "audio/wav" } }));
  await assert.rejects(requestAudio({}, new AbortController().signal), error => error instanceof ClientError && error.code === "INVALID_AUDIO");
});
