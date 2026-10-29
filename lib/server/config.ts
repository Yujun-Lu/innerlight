import { environment } from "./runtime-env.ts";
import { ServiceError } from "./errors.ts";

export function serverConfig(env: Record<string, string | undefined> = environment()) {
  const key = env.DASHSCOPE_API_KEY?.trim() || "";
  const workspace = (env.TTS_WORKSPACE_ID || env.SFM_WORKSPACE_ID || env.DASHSCOPE_WORKSPACE_ID || "").trim();
  const ttsKey = (env.TTS_API_KEY || key).trim();
  const region = env.DASHSCOPE_REGION?.trim() || "cn-beijing";
  if (workspace && !/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(workspace)) throw new ServiceError("NOT_CONFIGURED", 503);
  if (!["cn-beijing", "ap-southeast-1"].includes(region)) throw new ServiceError("NOT_CONFIGURED", 503);
  const host = region === "cn-beijing" ? "dashscope.aliyuncs.com" : "dashscope-intl.aliyuncs.com";
  const configured = !!key && !/^(your|replace|placeholder|sk-your)/i.test(key);
  const model = (name: string, fallback: string) => {
    const value = env[name]?.trim() || fallback;
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(value)) throw new ServiceError("NOT_CONFIGURED", 503);
    return value;
  };
  return {
    key, ttsKey, configured, workspace,
    text: configured,
    audio: !!ttsKey && !/^(your|replace|placeholder|sk-your)/i.test(ttsKey) && !!workspace && region === "cn-beijing",
    asr: configured,
    textUrl: `https://${host}/compatible-mode/v1/chat/completions`,
    asrUrl: `https://${host}/api/v1/services/aigc/multimodal-generation/generation`,
    ttsUrl: `https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`,
    textModel: model("TEXT_MODEL", "qwen3.8-flash"),
    asrModel: model("ASR_MODEL", "qwen-audio-3.1-asr-flash"),
    ttsModel: model("TTS_MODEL", "qwen-audio-3.1-tts-next"),
  };
}
export type Config = ReturnType<typeof serverConfig>;
