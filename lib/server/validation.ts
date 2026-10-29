import { samples } from "../samples.ts";
import type { Mode, ScenarioId, Style } from "../types";
import { ServiceError } from "./errors.ts";

export function stringField(data: Record<string, unknown>, key: string, max = 2000): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) throw new ServiceError("INVALID_INPUT");
  if (value.length > max) throw new ServiceError(key === "text" ? "TOO_LONG" : "INVALID_INPUT");
  return value.trim();
}

export function optionalStringField(data: Record<string, unknown>, key: string, max = 200): string {
  const value = data[key];
  if (typeof value !== "string" || value.length > max) throw new ServiceError("INVALID_INPUT");
  return value.trim();
}
export function parseCommon(data: Record<string, unknown>): { text: string; style: Style; mode: Mode; scenarioId?: ScenarioId } {
  const text = stringField(data, "text");
  const style = data.style ?? "everyday";
  const mode = data.mode ?? "live";
  if (style !== "everyday" && style !== "spiritual") throw new ServiceError("INVALID_INPUT");
  if (mode !== "live" && mode !== "sample") throw new ServiceError("INVALID_INPUT");
  const scenarioId = data.scenarioId as ScenarioId | undefined;
  if (scenarioId !== undefined && !Object.hasOwn(samples, scenarioId)) throw new ServiceError("INVALID_INPUT");
  if (mode === "sample" && (!scenarioId || text !== samples[scenarioId].text)) throw new ServiceError("SAMPLE_CHANGED", 422);
  return { text, style, mode, scenarioId };
}

// This bounded check catches explicit danger statements, not all possible risk.
// A visible support entry remains available in the UI independently of this check.
export function needsImmediateSupport(text: string): boolean {
  return /(?:我|自己)(?:现在|真的|马上|已经|快要|就是|很)?(?:想要?|要|准备|打算|正在|决定)(?:去|马上)?(?:自杀|结束生命|结束自己的生命|伤害自己|割腕|跳楼|跳下去|杀死自己)|(?:不想活了|活不下去了|想死了|想去死|我要杀人|我想杀人)|\bi\s+(?:want|plan|am going|intend)\s+to\s+(?:kill myself|end my life|hurt myself|kill someone|die)\b|\bi['’]m\s+going\s+to\s+(?:kill myself|end my life|hurt myself|kill someone)\b/i.test(text);
}

export const supportReflection = {
  summary: "It sounds like you are in intense pain right now. Thank you for saying it. Put your immediate safety first: contact someone you trust and ask them to stay with you. If you are in immediate danger, contact local emergency services or go to the nearest emergency department.",
  feeling: "Your distress deserves serious attention", need: "Someone beside you and timely real-world support",
  belief: "You do not have to get through this moment alone.", supportRequired: true,
};

export function checkGeneratedText(value: string): void {
  const disallowedClaims = /(?:宇宙|高我|神明)(?:一定|必然|保证)|(?:频率低|能量低|不够相信|不够积极)(?:所以|才|导致)|治愈(?:抑郁|焦虑|疾病)|量子(?:治疗|治愈)|我(?:会)?永远爱你|只有我(?:能|才)(?:理解|懂)你|(?:the universe|your higher self|god)\s+(?:will definitely|guarantees?|must)|(?:quantum|energy)\s+(?:heals?|cures?)|(?:cures?|heals?)\s+(?:your\s+)?(?:depression|anxiety|illness)|i\s+(?:will\s+)?always\s+love\s+you|only\s+i\s+(?:can\s+)?understand\s+you|your\s+(?:low\s+)?(?:frequency|vibration)\s+(?:caused|causes)\s+(?:your\s+)?(?:pain|illness|suffering)/i;
  if (disallowedClaims.test(value) || /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(value)) throw new ServiceError("INVALID_OUTPUT", 502);
}
