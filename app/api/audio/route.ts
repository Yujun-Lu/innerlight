import { samples } from "../../../lib/samples.ts";
import type { ScenarioId } from "../../../lib/types";
import { synthesize } from "../../../lib/server/audio.ts";
import { serverConfig } from "../../../lib/server/config.ts";
import { errorResponse, readJson, ServiceError } from "../../../lib/server/errors.ts";
import { checkGeneratedText, needsImmediateSupport, stringField } from "../../../lib/server/validation.ts";

export async function POST(request: Request) {
  try {
    const data = await readJson(request);
    const script = stringField(data, "script", 3200);
    if (data.mode !== "live" && data.mode !== "sample") throw new ServiceError("INVALID_INPUT");
    if (data.mode === "sample") {
      const id = data.scenarioId as ScenarioId;
      if (!Object.hasOwn(samples, id) || script !== samples[id].meditation.script) throw new ServiceError("SAMPLE_CHANGED", 422);
      // 303 deliberately changes the POST to GET for the static audio asset.
      return Response.redirect(new URL(`/audio/${id}.wav`, request.url), 303);
    }
    checkGeneratedText(script);
    if (needsImmediateSupport(script)) throw new ServiceError("SUPPORT_REQUIRED", 422);
    const result = await synthesize(script, serverConfig(), request.signal);
    return new Response(result.bytes.buffer as ArrayBuffer, { headers: {
      "Content-Type": "audio/wav", "Cache-Control": "no-store", "Content-Disposition": "inline; filename=innerlight-meditation.wav",
      "X-Audio-Duration": result.duration.toFixed(2), "X-Audio-Source": "ai-generated", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}
