import { Buffer } from "node:buffer";
import { readPcmWav } from "../../../lib/server/audio.ts";
import { serverConfig } from "../../../lib/server/config.ts";
import { errorResponse, readJson, ServiceError, } from "../../../lib/server/errors.ts";
import { postJson, withTimeout } from "../../../lib/server/upstream.ts";

export async function POST(request: Request) {
  try {
    const data = await readJson(request, 2900000);
    if (typeof data.audioBase64 !== "string" || !data.audioBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audioBase64) || data.audioBase64.length % 4) throw new ServiceError("INVALID_AUDIO", 422);
    if (data.mimeType !== "audio/wav" && data.mimeType !== "audio/x-wav") throw new ServiceError("INVALID_AUDIO", 422);
    const bytes = Buffer.from(data.audioBase64, "base64");
    if (bytes.length > 2100000) throw new ServiceError("TOO_LARGE", 413);
    const wav = readPcmWav(bytes);
    const duration = wav.pcm.length / (wav.sampleRate * wav.channels * wav.bits / 8);
    if (wav.sampleRate !== 16000 || wav.channels !== 1 || wav.bits !== 16 || duration < 0.3 || duration > 65) throw new ServiceError("INVALID_AUDIO", 422);
    const config = serverConfig();
    if (!config.asr) throw new ServiceError("NOT_CONFIGURED", 503);
    const result = await withTimeout(request.signal, 65000, signal => postJson(config.asrUrl, config.key, {
      model: config.asrModel,
      input: { messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: `data:audio/wav;base64,${bytes.toString("base64")}` } }] }] },
      parameters: { format: "wav", sample_rate: "16000" },
    }, signal));
    const text = result.output?.text || result.output?.sentence?.text || (Array.isArray(result.output?.sentences) ? result.output.sentences.map((s: { text?: string }) => s.text || "").join("") : "");
    if (typeof text !== "string" || !text.trim()) throw new ServiceError("NO_SPEECH", 422);
    if (text.length > 2000) throw new ServiceError("TOO_LONG", 422);
    return Response.json({ text: text.trim() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
