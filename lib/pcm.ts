export const RECORDING_SAMPLE_RATE = 16000;
export const MAX_RECORDING_SECONDS = 45;
export const MIN_RECORDING_SECONDS = 0.35;

function checkedRate(rate: number): void {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new Error("The microphone returned an unsupported sample rate. Please try another device, or write instead.");
}

function finiteSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function measurePcm(samples: Float32Array): { rms: number; peak: number } {
  if (!samples.length) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (const raw of samples) {
    const value = finiteSample(raw);
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return { rms: Math.min(1, Math.sqrt(sum / samples.length)), peak: Math.min(1, peak) };
}

// A windowed-sinc low-pass filter removes frequencies above the destination
// Nyquist limit instead of folding them into speech during downsampling.
export function resampleMono(input: Float32Array, sourceRate: number, targetRate = RECORDING_SAMPLE_RATE): Float32Array {
  checkedRate(sourceRate);
  checkedRate(targetRate);
  if (sourceRate === targetRate) return Float32Array.from(input, finiteSample);
  const output = new Float32Array(Math.floor(input.length * targetRate / sourceRate));
  if (!input.length) return output;
  const taps = 48;
  const half = taps / 2;
  const phases = 128;
  const cutoff = Math.min(1, targetRate / sourceRate) * 0.47;
  const filters = Array.from({ length: phases }, (_, phase) => {
    const weights = new Float64Array(taps);
    let sum = 0;
    for (let tap = 0; tap < taps; tap++) {
      const distance = tap - (half - 1) - phase / phases;
      const argument = 2 * cutoff * distance;
      const sinc = Math.abs(argument) < 1e-12 ? 1 : Math.sin(Math.PI * argument) / (Math.PI * argument);
      const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / half) + 0.08 * Math.cos(2 * Math.PI * distance / half);
      weights[tap] = 2 * cutoff * sinc * window;
      sum += weights[tap];
    }
    for (let tap = 0; tap < taps; tap++) weights[tap] /= sum;
    return weights;
  });
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < output.length; i++) {
    const position = i * ratio;
    const center = Math.floor(position);
    const phase = Math.min(phases - 1, Math.floor((position - center) * phases));
    const weights = filters[phase];
    let value = 0;
    for (let tap = 0; tap < taps; tap++) {
      const index = Math.max(0, Math.min(input.length - 1, center + tap - (half - 1)));
      value += finiteSample(input[index]) * weights[tap];
    }
    output[i] = value;
  }
  return output;
}

export function encodePcm16Wav(samples: Float32Array, sampleRate = RECORDING_SAMPLE_RATE): ArrayBuffer {
  checkedRate(sampleRate);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, finiteSample(samples[i])));
    view.setInt16(44 + i * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
  }
  return buffer;
}

export function prepareRecording(parts: readonly Float32Array[], sourceRate: number): ArrayBuffer {
  checkedRate(sourceRate);
  const cap = sourceRate * MAX_RECORDING_SECONDS;
  let length = 0;
  for (const part of parts) {
    length += Math.min(part.length, cap - length);
    if (length === cap) break;
  }
  if (length < Math.ceil(sourceRate * MIN_RECORDING_SECONDS)) throw new Error("That recording was a little short. Try again, or write it down.");
  const input = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    const count = Math.min(part.length, length - offset);
    if (count) input.set(part.subarray(0, count), offset);
    offset += count;
    if (offset === length) break;
  }
  const { rms, peak } = measurePcm(input);
  if (rms < 0.001 && peak < 0.01) throw new Error("We couldn't hear enough sound. Check your microphone and try again, or write instead.");
  return encodePcm16Wav(resampleMono(input, sourceRate));
}
