class InnerlightRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.frames = 0;
    this.maxFrames = Math.floor(sampleRate * 45);
    this.buffer = new Float32Array(2048);
    this.used = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type !== "stop") return;
      this.active = false;
      this.flush();
      this.port.postMessage({ type: "stopped" });
    };
  }

  flush() {
    if (!this.used) return;
    const samples = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: "chunk", samples }, [samples.buffer]);
    this.used = 0;
  }

  process(inputs, outputs) {
    for (const channels of outputs) for (const channel of channels) channel.fill(0);
    const channels = inputs[0];
    if (!this.active || !channels?.length || !channels[0]?.length) return true;
    const available = Math.min(channels[0].length, this.maxFrames - this.frames);
    for (let i = 0; i < available; i++) {
      let sample = 0;
      for (const channel of channels) sample += Number.isFinite(channel[i]) ? channel[i] : 0;
      this.buffer[this.used++] = sample / channels.length;
      this.frames++;
      if (this.used === this.buffer.length) this.flush();
    }
    if (this.frames >= this.maxFrames) {
      this.active = false;
      this.flush();
      this.port.postMessage({ type: "limit" });
    }
    return true;
  }
}

registerProcessor("innerlight-recorder", InnerlightRecorder);
