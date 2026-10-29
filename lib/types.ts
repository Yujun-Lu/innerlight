export type Style = "everyday" | "spiritual";
export type Mode = "live" | "sample";
export type ScenarioId = "giving" | "unanswered" | "direction";
export interface Reflection {
  summary: string;
  feeling: string;
  need: string;
  belief: string;
  source: Mode;
  supportRequired?: boolean;
}
export interface Meditation {
  title: string;
  script: string;
  affirmation: string;
  action: string;
  boundary: string;
  source: Mode;
}
export interface ServiceStatus { text: boolean; audio: boolean; asr: boolean }
export interface ApiError { error: { code: string; message: string } }
