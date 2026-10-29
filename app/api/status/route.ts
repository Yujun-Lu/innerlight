import { serverConfig } from "../../../lib/server/config.ts";

export async function GET() {
  try {
    const config = serverConfig();
    return Response.json({ text: config.text, audio: config.audio, asr: config.asr }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ text: false, audio: false, asr: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
