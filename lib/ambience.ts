export interface Ambience {
  setVolume: (volume: number) => void;
  stop: () => Promise<void>;
}

/** A quiet, locally synthesized sound bed. Call only from a user gesture. */
export async function createAmbience(): Promise<Ambience> {
  if (!window.AudioContext) throw new Error("Ambient sound is not available in this browser.");
  const context = new AudioContext();
  const sources: AudioScheduledSourceNode[] = [];
  const close = async () => {
    for (const source of sources) {
      try { source.stop(); } catch { /* Already stopped sources need no further work. */ }
    }
    if (context.state !== "closed") {
      try { await context.close(); } catch { /* Browser teardown may already own the context. */ }
    }
  };
  try {
    await context.resume();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const length = context.sampleRate * 8;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index++) {
      previous = (previous + (Math.random() * 2 - 1) * 0.016) / 1.016;
      const edge = Math.min(1, index / (context.sampleRate * 0.3), (length - index - 1) / (context.sampleRate * 0.3));
      channel[index] = previous * 2.5 * Math.max(0, edge);
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 620;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.48;
    noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(master);
    noise.start(); sources.push(noise);

    [174.614, 220, 261.626].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = [-3, 2, -1][index];
      const gain = context.createGain();
      gain.gain.value = [0.022, 0.017, 0.013][index];
      oscillator.connect(gain); gain.connect(master); oscillator.start(); sources.push(oscillator);
    });
    let stopPromise: Promise<void> | null = null;
    return {
      setVolume(volume) {
        if (stopPromise || context.state === "closed") return;
        const value = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
        master.gain.cancelScheduledValues(context.currentTime);
        master.gain.setTargetAtTime(value, context.currentTime, 0.3);
      },
      stop() {
        if (!stopPromise) stopPromise = (async () => {
          try {
            if (context.state === "running") {
              master.gain.cancelScheduledValues(context.currentTime);
              master.gain.setTargetAtTime(0, context.currentTime, 0.06);
              await new Promise(resolve => setTimeout(resolve, 180));
            }
          } finally { await close(); }
        })();
        return stopPromise;
      },
    };
  } catch {
    await close();
    throw new Error("Ambient sound could not start. Your reflection can still play on its own.");
  }
}
