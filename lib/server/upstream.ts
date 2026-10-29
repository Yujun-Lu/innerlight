import { ServiceError } from "./errors.ts";

export async function withTimeout<T>(requestSignal: AbortSignal, timeout: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let expired = false;
  const cancel = () => controller.abort();
  if (requestSignal.aborted) cancel();
  requestSignal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { expired = true; controller.abort(); }, timeout);
  try { return await run(controller.signal); }
  catch (error) {
    controller.abort();
    if (expired) throw new ServiceError("TIMEOUT", 504);
    if (requestSignal.aborted) throw new ServiceError("CANCELLED", 499);
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("NETWORK_ERROR", 502);
  } finally { clearTimeout(timer); requestSignal.removeEventListener("abort", cancel); }
}

export async function postJson(url: string, key: string, body: unknown, signal: AbortSignal): Promise<Record<string, any>> {
  const response = await fetch(url, { method: "POST", signal, redirect: "manual",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-DashScope-SSE": "disable" },
    body: JSON.stringify(body),
  });
  if (response.status >= 300 && response.status < 400) throw new ServiceError("NETWORK_ERROR", 502);
  let data: Record<string, any>;
  try { data = await response.json() as Record<string, any>; } catch { throw new ServiceError("INVALID_OUTPUT", 502); }
  if (!response.ok || data.code || data.error) {
    const code = String(data.code || data.error?.code || "").toLowerCase();
    if ([401, 403].includes(response.status) || /invalidapikey|invalid_api_key|accessdenied|unauthorized|forbidden/.test(code)) throw new ServiceError("AUTH_FAILED", 502);
    if ([402, 429].includes(response.status) || /throttl|quota|limit|arrear|balance/.test(code)) throw new ServiceError("RATE_LIMITED", 429);
    if ([408, 504].includes(response.status)) throw new ServiceError("TIMEOUT", 504);
    throw new ServiceError("NETWORK_ERROR", 502);
  }
  return data;
}
