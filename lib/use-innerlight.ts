"use client";

import { useEffect, useRef, useState } from "react";
import { startRecording, type AudioRecording } from "./client-audio";
import { samples } from "./samples";
import type { Meditation, Mode, Reflection, ScenarioId, ServiceStatus, Style } from "./types";
import { ClientError, downloadBlob, requestAudio, requestJson } from "./client-api";
import { SessionGuard, type SessionRequest } from "./session-guard";

export type SessionPhase = "idle" | "reflect" | "meditation" | "audio" | "transcribe" | "record";
type Operation = "reflect" | "meditation" | "audio" | "transcribe";
type RecordingPayload = { audioBase64: string; mimeType: string };
const invalid = () => new ClientError("INVALID_RESPONSE", "This response wasn't complete. Please try again.");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
};
function fields(value: unknown, names: string[], source: Mode): Record<string, unknown> {
  const result = object(value);
  if (result.source !== source || names.some(name => typeof result[name] !== "string" || !(result[name] as string).trim())) throw invalid();
  return result;
}

export function useInnerlight() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setModeState] = useState<Mode>("live");
  const [style, setStyleState] = useState<Style>("everyday");
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [sampleId, setSampleId] = useState<ScenarioId>("giving");
  const [capability, setCapability] = useState<ServiceStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [meditation, setMeditation] = useState<Meditation | null>(null);
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [phaseStartedAt, setPhaseStartedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [failedOperation, setFailedOperation] = useState<Operation | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const audioUrlRef = useRef("");
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordLevel, setRecordLevel] = useState(0);
  const [notice, setNotice] = useState("");
  const [feedback, setFeedback] = useState("");
  const guard = useRef(new SessionGuard());
  const recorder = useRef<AudioRecording | null>(null);
  const recordEpoch = useRef(0);
  const recordStart = useRef(0);
  const lastRecording = useRef<RecordingPayload | null>(null);
  const currentOperation = useRef<Operation | null>(null);
  const lastResultContext = useRef<{ text: string; mode: Mode; style: Style; scenarioId?: ScenarioId; summary: string; need: string; belief: string } | null>(null);
  const statusRequest = useRef<AbortController | null>(null);
  const touched = useRef(false);
  const mounted = useRef(true);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = mode === "sample" ? samples[sampleId].text : draft;
  const scenarioId = mode === "sample" ? sampleId : undefined;
  const busy = phase !== "idle";

  function clearError() { setError(""); setErrorCode(""); setFailedOperation(null); }
  function flash(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => { if (mounted.current) setNotice(""); }, 4200);
  }
  function writeDraft(value: string) { draftRef.current = value; setDraft(value); }
  function setText(value: string) {
    if (mode !== "live" || guard.current.busy || recorder.current) return;
    touched.current = true;
    if (value !== draftRef.current) setReflection(null);
    writeDraft(value); clearError();
  }
  function chooseMode(next: Mode) {
    if (guard.current.busy || recorder.current) return;
    touched.current = true;
    if (next !== mode) setReflection(null);
    setModeState(next); clearError();
  }
  function chooseScenario(id: ScenarioId) {
    if (guard.current.busy || recorder.current) return;
    touched.current = true; clearError();
    // Exploring an example must never replace the user's private live draft.
    if (mode !== "sample" || id !== sampleId) setReflection(null);
    setSampleId(id); setModeState("sample");
  }
  function setStyle(next: Style) {
    if (mode === "live" && !guard.current.busy && !recorder.current) { touched.current = true; setStyleState(next); }
  }
  async function refreshStatus() {
    statusRequest.current?.abort();
    const controller = new AbortController(); statusRequest.current = controller;
    setStatusLoading(true); setStatusError("");
    try {
      const result = object(await requestJson("/api/status", undefined, controller.signal, 15000));
      if (["text", "audio", "asr"].some(key => typeof result[key] !== "boolean")) throw invalid();
      if (!mounted.current || statusRequest.current !== controller || controller.signal.aborted) return;
      const status = result as unknown as ServiceStatus;
      setCapability(status);
      if (!status.text && !touched.current && !draftRef.current && !guard.current.busy) setModeState("sample");
      if (!status.text) setStatusError("Live sessions aren't connected right now. The sample journeys are ready to explore.");
    } catch {
      if (!mounted.current || controller.signal.aborted || statusRequest.current !== controller) return;
      setCapability({ text: false, audio: false, asr: false });
      setStatusError("We couldn't check the live connection. Try again, or explore a sample journey.");
      if (!touched.current && !draftRef.current && !guard.current.busy) setModeState("sample");
    } finally {
      if (mounted.current && statusRequest.current === controller) setStatusLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => {
      mounted.current = false; guard.current.cancel(); statusRequest.current?.abort();
      recordEpoch.current++; recorder.current?.cancel(); recorder.current = null;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
    // The initial connection check is independent of the evolving private draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function begin(next: SessionPhase, operation: Operation | null): SessionRequest | null {
    if (recorder.current) return null;
    const request = guard.current.start();
    if (!request) return null;
    currentOperation.current = operation; setPhase(next); setPhaseStartedAt(Date.now()); clearError();
    return request;
  }
  const valid = (request: SessionRequest) => mounted.current && guard.current.valid(request);
  function finish(request: SessionRequest) {
    if (mounted.current && guard.current.finish(request)) { setPhase("idle"); setPhaseStartedAt(null); currentOperation.current = null; }
  }
  function fail(errorValue: unknown, request: SessionRequest, operation: Operation) {
    if (!mounted.current || !guard.current.owns(request)) return;
    const problem = errorValue instanceof ClientError ? errorValue : new ClientError("CONNECTION", "We couldn't complete this moment. Your words are still here; you can try again.");
    setError(problem.message); setErrorCode(problem.code); setFailedOperation(operation);
    if (problem.code === "SUPPORT_REQUIRED") {
      setReflection(previous => previous ? { ...previous, summary: problem.message, supportRequired: true } : previous);
      setStep(2);
    }
  }
  function replaceAudio(blob: Blob | null) {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = blob ? URL.createObjectURL(blob) : "";
    audioUrlRef.current = url; setAudioUrl(url); setAudioBlob(blob);
  }
  async function reflect() {
    if (!text.trim() || text.length > 2000 || (mode === "live" && !capability?.text)) {
      if (text.length > 2000) { setError("Let's start with up to 2,000 characters. Your full words are here for you to edit."); setErrorCode("TOO_LONG"); }
      return;
    }
    const request = begin("reflect", "reflect"); if (!request) return;
    try {
      const result = fields(await requestJson("/api/reflect", { text, style: mode === "sample" ? "everyday" : style, mode, scenarioId }, request.signal), ["summary", "feeling", "need", "belief"], mode);
      if (result.supportRequired !== undefined && typeof result.supportRequired !== "boolean") throw invalid();
      if (!valid(request)) return;
      setReflection(result as unknown as Reflection); setStep(2);
    } catch (errorValue) { fail(errorValue, request, "reflect"); }
    finally { finish(request); }
  }
  function updateReflection(patch: Partial<Pick<Reflection, "summary" | "need" | "belief">>) {
    if (mode === "sample" || guard.current.busy || recorder.current) return;
    setReflection(previous => previous ? { ...previous, ...patch } : previous); clearError();
  }
  async function audioFor(result: Meditation, request: SessionRequest) {
    if (!valid(request)) return;
    currentOperation.current = "audio"; setPhase("audio"); setPhaseStartedAt(Date.now());
    const audioScenarioId = result.source === "sample" ? lastResultContext.current?.scenarioId : undefined;
    const blob = await requestAudio({ script: result.script, mode: result.source, scenarioId: audioScenarioId }, request.signal);
    if (!valid(request)) return;
    replaceAudio(blob);
  }
  async function createMeditation() {
    if (!reflection || reflection.supportRequired || !reflection.summary.trim() || !reflection.need.trim()) return;
    const request = begin("meditation", "meditation"); if (!request) return;
    let operation: Operation = "meditation";
    try {
      const result = fields(await requestJson("/api/meditation", {
        text, summary: reflection.summary, need: reflection.need, belief: reflection.belief,
        style: mode === "sample" ? "everyday" : style, mode, scenarioId,
      }, request.signal), ["title", "script", "affirmation", "action", "boundary"], mode) as unknown as Meditation;
      if (!valid(request)) return;
      lastResultContext.current = { text, mode, style: mode === "sample" ? "everyday" : style, scenarioId, summary: reflection.summary, need: reflection.need, belief: reflection.belief };
      setMeditation(result); replaceAudio(null); setFeedback(""); setStep(3);
      if (mode === "sample" || capability?.audio) { operation = "audio"; await audioFor(result, request); }
      else { setError("Your written reflection is ready. The voice service isn't connected right now."); setErrorCode("NOT_CONFIGURED"); setFailedOperation("audio"); }
    } catch (errorValue) { fail(errorValue, request, operation); }
    finally { finish(request); }
  }
  async function retryAudio() {
    if (!meditation) return;
    const request = begin("audio", "audio"); if (!request) return;
    try { await audioFor(meditation, request); }
    catch (errorValue) { fail(errorValue, request, "audio"); }
    finally { finish(request); }
  }
  async function transcribe(payload: RecordingPayload, request: SessionRequest) {
    const data = object(await requestJson("/api/transcribe", payload, request.signal));
    if (typeof data.text !== "string" || !data.text.trim()) throw invalid();
    if (!valid(request)) return;
    const previous = draftRef.current.trim();
    setReflection(null);
    writeDraft(previous ? `${previous}\n${data.text.trim()}` : data.text.trim());
    lastRecording.current = null;
    flash("Your words are here. You can make them your own.");
  }
  async function beginRecording() {
    if (mode !== "live" || !capability?.asr || recorder.current) return;
    const request = begin("record", null); if (!request) return;
    touched.current = true; const epoch = ++recordEpoch.current;
    setRecordSeconds(0); setRecordLevel(0); lastRecording.current = null;
    try {
      const capture = await startRecording({
        onLevel: (level: number) => { if (mounted.current && epoch === recordEpoch.current) setRecordLevel(level); },
        onLimit: () => { if (mounted.current && epoch === recordEpoch.current) void finishRecording(); },
        onError: () => { if (mounted.current && epoch === recordEpoch.current) void finishRecording(); },
      });
      if (!valid(request) || epoch !== recordEpoch.current) { capture.cancel(); return; }
      recorder.current = capture; recordStart.current = performance.now(); setRecording(true);
    } catch (errorValue) {
      if (valid(request)) { setError(errorValue instanceof Error ? errorValue.message : "The microphone couldn't open. You can always write instead."); setErrorCode("MICROPHONE"); }
    } finally { finish(request); }
  }
  async function finishRecording() {
    const capture = recorder.current; if (!capture) return;
    recorder.current = null; recordEpoch.current++; setRecording(false); setRecordLevel(0);
    const request = begin("transcribe", "transcribe"); if (!request) { capture.cancel(); return; }
    try {
      const payload = await capture.stop();
      if (!valid(request)) return;
      lastRecording.current = payload; await transcribe(payload, request);
    } catch (errorValue) {
      const problem = errorValue instanceof ClientError ? errorValue : new ClientError("RECORDING", errorValue instanceof Error ? errorValue.message : "We couldn't read the recording. You can write instead.");
      fail(problem, request, "transcribe");
    } finally { finish(request); }
  }
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const seconds = Math.min(45, Math.floor((performance.now() - recordStart.current) / 1000));
      setRecordSeconds(seconds);
      if (seconds >= 45) void finishRecording();
    }, 200);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);
  function cancelWaiting() {
    const previous = currentOperation.current;
    recordEpoch.current++; guard.current.cancel();
    setPhase("idle"); setPhaseStartedAt(null); currentOperation.current = null;
    setError("Stopped waiting. You can try again when you're ready."); setErrorCode("CANCELLED"); setFailedOperation(previous);
  }
  function goTo(next: 1 | 2) {
    if (guard.current.busy || recorder.current || (next === 2 && !reflection)) return;
    setStep(next); clearError();
  }
  function goBack() { goTo(step === 3 && reflection ? 2 : 1); }
  function resumeResult() {
    if (!meditation || guard.current.busy || recorder.current) return;
    setStep(3); clearError();
  }
  function reset() {
    recordEpoch.current++; guard.current.cancel(); recorder.current?.cancel(); recorder.current = null;
    lastRecording.current = null; currentOperation.current = null; lastResultContext.current = null;
    setRecording(false); setRecordLevel(0); setRecordSeconds(0); setPhase("idle"); setPhaseStartedAt(null);
    setReflection(null); setMeditation(null); replaceAudio(null); setFeedback(""); clearError(); setStep(1);
  }
  async function retry() {
    if (failedOperation === "audio") return retryAudio();
    if (failedOperation === "meditation") return createMeditation();
    if (failedOperation === "reflect") return reflect();
    if (failedOperation === "transcribe") {
      if (!lastRecording.current) return beginRecording();
      const request = begin("transcribe", "transcribe"); if (!request) return;
      try { await transcribe(lastRecording.current, request); }
      catch (errorValue) { fail(errorValue, request, "transcribe"); }
      finally { finish(request); }
    }
  }
  const takeawayText = meditation ? `${meditation.title}\n\nA thought to keep\n${meditation.affirmation}\n\nOne small choice\n${meditation.action}\n\nWords I can borrow\n${meditation.boundary}\n\nListening is enough today. Action can wait.\n\n— Innerlight · Return to yourself` : "";
  async function copyTakeaway() {
    if (!takeawayText) return;
    try { await navigator.clipboard.writeText(takeawayText); flash("Copied. A little care to take with you."); }
    catch { downloadText(); flash("Your reminder has been saved as text."); }
  }
  function downloadText() { if (takeawayText) downloadBlob(new Blob([takeawayText], { type: "text/plain;charset=utf-8" }), "innerlight-reminder.txt"); }
  function downloadAudio() { if (audioBlob) downloadBlob(audioBlob, "innerlight-meditation.wav"); }
  const savedContext = lastResultContext.current;
  const resultIsCurrent = !!savedContext && savedContext.mode === mode && savedContext.text === text
    && savedContext.style === (mode === "sample" ? "everyday" : style)
    && savedContext.summary === reflection?.summary && savedContext.need === reflection?.need && savedContext.belief === reflection?.belief;

  return {
    step, mode, style, text, scenarioId, capability, reflection, meditation, phase, phaseStartedAt,
    error, errorCode, failedOperation, notice, feedback, recording, recordSeconds, recordLevel,
    audioUrl, audioBlob, busy, statusLoading, statusError, hasSession: !!reflection || !!meditation || busy || recording, takeawayText, resultIsCurrent,
    chooseMode, chooseScenario, setText, setStyle, updateReflection, reflect, createMeditation, retryAudio, retry,
    beginRecording, finishRecording, cancelWaiting, goTo, goBack, resumeResult, reset, setFeedback, flash, clearError,
    refreshStatus, copyTakeaway, downloadText, downloadAudio,
  };
}
