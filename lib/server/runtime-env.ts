import { AsyncLocalStorage } from "node:async_hooks";

type RuntimeEnv = object;
const runtimeEnv = new AsyncLocalStorage<RuntimeEnv>();

export function runWithRuntimeEnv<T>(env: RuntimeEnv, run: () => T): T {
  return runtimeEnv.run(env, run);
}

export function environment(): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(runtimeEnv.getStore() ?? {})) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
