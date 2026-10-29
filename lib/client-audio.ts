import { MAX_RECORDING_SECONDS, measurePcm, prepareRecording } from "./pcm.ts";

type RecordedAudio = { audioBase64: string; mimeType: string };
export type AudioRecording = { stop: () => Promise<RecordedAudio>; cancel: () => void };
export type RecordingOptions = { onLevel?: (rms: number) => void; onLimit?: () => void; onError?: (message: string) => void };

export async function startRecording(options: RecordingOptions = {}): Promise<AudioRecording> {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || typeof AudioWorkletNode === "undefined") {
    throw new Error("This browser doesn't support secure audio recording. Try a current browser, or write your feelings down instead.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) throw new Error("Microphone access wasn't allowed. You can enable it in your browser, or write instead.");
    throw new Error("We couldn't open your microphone. Check your device, or write instead.");
  }

  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let mute: GainNode | undefined;
  let wallTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let flushPromise: Promise<void> | undefined;
  let finishFlush: (() => void) | undefined;
  let stopPromise: Promise<RecordedAudio> | undefined;
  let captureEnded = false;
  let canceled = false;
  let cleaned = false;
  let limitNotified = false;
  let errorNotified = false;
  let failure: Error | undefined;
  let frames = 0;
  const parts: Float32Array[] = [];
  const tracks = stream.getTracks();

  const reportLevel = (rms: number) => {
    try { options.onLevel?.(rms); } catch { /* A UI callback must not break microphone cleanup. */ }
  };
  const reportFailure = (message: string) => {
    if (cleaned || canceled || failure) return;
    failure = new Error(message);
    captureEnded = true;
    finishFlush?.();
    void cleanup();
    if (!errorNotified) {
      errorNotified = true;
      try { options.onError?.(message); } catch { /* The same failure remains available from stop(). */ }
    }
  };
  const interrupted = () => reportFailure("The microphone disconnected. Please record again, or write instead.");
  const cleanup = (): Promise<void> => {
    if (cleaned) return cleanupPromise ?? Promise.resolve();
    cleaned = true;
    cleanupPromise = Promise.resolve();
    clearTimeout(wallTimer);
    clearTimeout(flushTimer);
    for (const track of tracks) {
      track.removeEventListener("ended", interrupted);
      try { track.stop(); } catch { /* Continue releasing the other microphone resources. */ }
    }
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.onprocessorerror = null;
      try { worklet.port.close(); } catch { /* An already closed message port is harmless. */ }
    }
    for (const node of [source, worklet, mute]) {
      try { node?.disconnect(); } catch { /* Disconnecting an already detached node is harmless. */ }
    }
    reportLevel(0);
    try { cleanupPromise = context && context.state !== "closed" ? context.close().catch(() => undefined) : Promise.resolve(); }
    catch { cleanupPromise = Promise.resolve(); }
    return cleanupPromise;
  };
  const requestFlush = (): Promise<void> => {
    if (captureEnded || cleaned) return Promise.resolve();
    if (flushPromise) return flushPromise;
    flushPromise = new Promise<void>((resolve) => {
      finishFlush = () => { clearTimeout(flushTimer); resolve(); };
      // A closed or interrupted audio thread must not leave stop() hanging.
      flushTimer = setTimeout(() => { captureEnded = true; resolve(); }, 700);
      try { worklet?.port.postMessage({ type: "stop" }); }
      catch { captureEnded = true; finishFlush(); }
    });
    return flushPromise;
  };
  const reachLimit = () => {
    if (canceled || limitNotified) return;
    limitNotified = true;
    captureEnded = true;
    finishFlush?.();
    void cleanup();
    try { options.onLimit?.(); } catch { /* The captured audio remains available through stop(). */ }
  };

  try {
    context = new AudioContext({ latencyHint: "interactive" });
    if (!context.audioWorklet) throw new Error("AudioWorklet is unavailable.");
    await context.audioWorklet.addModule("/recording-worklet.js");
    source = context.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(context, "innerlight-recorder", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit",
    });
    mute = context.createGain();
    mute.gain.value = 0;
    const maxFrames = Math.floor(context.sampleRate * MAX_RECORDING_SECONDS);
    worklet.port.onmessage = (event: MessageEvent) => {
      if (cleaned || canceled) return;
      if (event.data?.type === "chunk" && event.data.samples instanceof Float32Array) {
        const count = Math.min(event.data.samples.length, maxFrames - frames);
        if (count > 0) {
          const samples = event.data.samples.subarray(0, count);
          parts.push(samples);
          frames += count;
          reportLevel(measurePcm(samples).rms);
        }
        if (frames >= maxFrames) reachLimit();
      } else if (event.data?.type === "stopped") {
        captureEnded = true;
        finishFlush?.();
      } else if (event.data?.type === "limit") reachLimit();
    };
    worklet.onprocessorerror = () => reportFailure("The recording stopped unexpectedly. Please try again, or write instead.");
    for (const track of tracks) track.addEventListener("ended", interrupted);
    source.connect(worklet); worklet.connect(mute); mute.connect(context.destination);
    if (tracks.some(track => track.readyState === "ended")) interrupted();
    await context.resume();
    if (failure || cleaned) throw failure ?? new Error("The recording ended before it could start.");
    wallTimer = setTimeout(() => {
      void requestFlush().then(() => { if (!canceled) reachLimit(); });
    }, MAX_RECORDING_SECONDS * 1000);
  } catch {
    await cleanup();
    if (failure) throw failure;
    throw new Error("We couldn't start secure microphone recording. Please try again in a current browser, or write instead.");
  }

  if (failure || cleaned) {
    await cleanup();
    throw failure ?? new Error("The recording ended before it could start. Please try again, or write instead.");
  }
  const sourceRate = context.sampleRate;
  return {
    cancel: () => {
      if (canceled) return;
      canceled = true;
      captureEnded = true;
      finishFlush?.();
      parts.length = 0;
      void cleanup();
    },
    stop: () => {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (canceled) throw new Error("This recording was canceled. You can start a new one whenever you're ready.");
        await requestFlush();
        captureEnded = true;
        await cleanup();
        if (canceled) throw new Error("This recording was canceled. You can start a new one whenever you're ready.");
        if (failure) throw failure;
        let buffer: ArrayBuffer;
        try { buffer = prepareRecording(parts, sourceRate); }
        finally { parts.length = 0; }
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return { audioBase64: btoa(binary), mimeType: "audio/wav" };
      })();
      return stopPromise;
    },
  };
}
