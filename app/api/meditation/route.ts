import { samples } from "../../../lib/samples.ts";
import { errorResponse, readJson, ServiceError } from "../../../lib/server/errors.ts";
import { generateMeditation } from "../../../lib/server/generation.ts";
import { needsImmediateSupport, optionalStringField, parseCommon, stringField } from "../../../lib/server/validation.ts";

export async function POST(request: Request) {
  try {
    const data = await readJson(request);
    const input = { ...parseCommon(data), summary: stringField(data, "summary", 500), need: stringField(data, "need", 200), belief: optionalStringField(data, "belief", 200) };
    if (needsImmediateSupport([input.text, input.summary, input.need, input.belief].join("\n"))) throw new ServiceError("SUPPORT_REQUIRED", 422);
    if (input.mode === "sample") {
      const sample = samples[input.scenarioId!];
      if (input.summary !== sample.reflection.summary || input.need !== sample.reflection.need || input.belief !== sample.reflection.belief) throw new ServiceError("SAMPLE_CHANGED", 422);
      return Response.json(sample.meditation, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await generateMeditation(input, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
