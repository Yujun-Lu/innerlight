import { samples } from "../../../lib/samples.ts";
import { errorResponse, readJson } from "../../../lib/server/errors.ts";
import { generateReflection } from "../../../lib/server/generation.ts";
import { needsImmediateSupport, parseCommon, supportReflection } from "../../../lib/server/validation.ts";

export async function POST(request: Request) {
  try {
    const input = parseCommon(await readJson(request));
    if (needsImmediateSupport(input.text)) return Response.json({ ...supportReflection, source: input.mode }, { headers: { "Cache-Control": "no-store" } });
    const result = input.mode === "sample" ? samples[input.scenarioId!].reflection
      : await generateReflection(input.text, input.style, request.signal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
