export class ClientError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "ClientError"; }
}

async function withClientTimeout<T>(signal: AbortSignal, timeout: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let expired = false;
  const cancel = () => controller.abort();
  if (signal.aborted) cancel();
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { expired = true; controller.abort(); }, timeout);
  try {
    const result = await run(controller.signal);
    if (expired) throw new ClientError("TIMEOUT", "This is taking longer than expected. Your words are still here; you can try again.");
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    return result;
  } catch (error) {
    if (expired) throw new ClientError("TIMEOUT", "This is taking longer than expected. Your words are still here; you can try again.");
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    if (error instanceof ClientError) throw error;
    throw new ClientError("CONNECTION", "We couldn't reach the service. Your words are still here. Please try again when you're ready.");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

async function responseError(response: Response): Promise<ClientError> {
  let data: unknown;
  try { data = await response.json(); } catch { /* A proxy may return an HTML error page. */ }
  const error = data && typeof data === "object" && "error" in data ? (data as { error?: unknown }).error : null;
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string" && value.message.length <= 600) {
      return new ClientError(value.code, value.message);
    }
  }
  return new ClientError("CONNECTION", "The service couldn't complete this request. Your words are still here; please try again.");
}

export async function requestJson(path: string, body: unknown, signal: AbortSignal, timeout = 75000): Promise<unknown> {
  return withClientTimeout(signal, timeout, async active => {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST", signal: active, cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await responseError(response);
    try { return await response.json(); }
    catch { throw new ClientError("INVALID_RESPONSE", "This response arrived incomplete. Please try once more."); }
  });
}

export async function requestAudio(body: unknown, signal: AbortSignal): Promise<Blob> {
  return withClientTimeout(signal, 315000, async active => {
    const response = await fetch("/api/audio", {
      method: "POST", signal: active, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw await responseError(response);
    const blob = await response.blob();
    if (blob.size < 44 || blob.size > 40 * 1024 * 1024) throw new ClientError("INVALID_AUDIO", "The audio arrived incomplete. Your written reflection is ready; you can try the voice again.");
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const text = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
    if (text(0, 4) !== "RIFF" || text(8, 12) !== "WAVE") throw new ClientError("INVALID_AUDIO", "We couldn't read this audio file. Your written reflection is ready; you can try the voice again.");
    return new Blob([blob], { type: "audio/wav" });
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
