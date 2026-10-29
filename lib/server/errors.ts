export class ServiceError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const messages: Record<string, string> = {
  INVALID_INPUT: "We couldn't read this request. Please check it and try again.",
  TOO_LONG: "Please start with the one thing you most want to share, using 2,000 characters or fewer.",
  TOO_LARGE: "This recording or request is too large. Please keep recordings under one minute.",
  INVALID_AUDIO: "We couldn't read that recording. Please record again, or use the text box.",
  NO_SPEECH: "We couldn't hear clear speech. You can record again or type what you want to say.",
  FORBIDDEN: "Please make this request from the Innerlight page.",
  SAMPLE_CHANGED: "You've changed the example. Switch to personalized mode to receive a response to your own words.",
  NOT_CONFIGURED: "Personalized services aren't connected yet. You can explore the clearly labeled demo examples.",
  AUTH_FAILED: "We couldn't connect to the personalized service. Please try later, or explore a demo example.",
  RATE_LIMITED: "The service is busy. Please wait a little before trying again.",
  TIMEOUT: "This is taking longer than expected, and we couldn't retrieve a result. You can try again later.",
  CANCELLED: "This generation was canceled.",
  NETWORK_ERROR: "The connection was interrupted. Your words are still here, so you can try again later.",
  INVALID_OUTPUT: "This response wasn't generated completely. Please try again.",
  AUDIO_FAILED: "The audio isn't ready right now. You can read the words first and try generating the voice later.",
  SUPPORT_REQUIRED: "Real-world support matters right now. Please contact someone you trust, a qualified professional, or local emergency services.",
};

export function errorResponse(error: unknown): Response {
  const safe = error instanceof ServiceError ? error : new ServiceError("NETWORK_ERROR", 502);
  return Response.json({ error: { code: safe.code, message: messages[safe.code] ?? messages.NETWORK_ERROR } },
    { status: safe.status, headers: { "Cache-Control": "no-store" } });
}

export function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ServiceError("FORBIDDEN", 403);
  if (origin && origin !== new URL(request.url).origin) throw new ServiceError("FORBIDDEN", 403);
}

export async function readJson(request: Request, limit = 16000): Promise<Record<string, unknown>> {
  checkOrigin(request);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ServiceError("INVALID_INPUT");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw new ServiceError("TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError("INVALID_INPUT");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new ServiceError("TOO_LARGE", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ServiceError("INVALID_INPUT"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ServiceError("INVALID_INPUT");
  return parsed as Record<string, unknown>;
}
