"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, Copy, Download,
  FileText, Headphones, Heart, Image as ImageIcon, Leaf, LoaderCircle,
  Maximize2, Mic, Pause, Play, RotateCcw, RotateCw, ShieldCheck,
  Sparkles, Square, Sun, Volume2, VolumeX, Waves, X,
} from "lucide-react";
import { useInnerlight } from "../lib/use-innerlight";
import { sampleList } from "../lib/samples";
import { createAmbience, type Ambience } from "../lib/ambience";
import { createReminderPng } from "../lib/reminder-card";
import { downloadBlob } from "../lib/client-api";

type Session = ReturnType<typeof useInnerlight>;

function isSampleView(session: Session) {
  return session.step === 3 && session.meditation
    ? session.meditation.source === "sample"
    : session.mode === "sample";
}

const LIGHT_PARTICLES = [
  [5, 25, 1.8, 14, -3, 15], [13, 37, 2.2, 18, -8, -12],
  [25, 23, 1.5, 20, -11, 16], [31, 49, 1.8, 16, -4, -14],
  [8, 64, 2.3, 19, -13, 10], [19, 70, 1.5, 22, -7, -17],
  [34, 30, 1.6, 17, -12, 11], [3, 78, 1.4, 21, -9, 12],
  [29, 81, 2, 18, -15, -10], [17, 18, 1.2, 24, -6, 13],
  [95, 34, 1.6, 22, -10, -9], [98, 59, 2, 19, -4, -12],
  [9, 88, 1.4, 24, -18, 8], [22, 56, 1.8, 21, -16, -14],
  [37, 68, 1.2, 20, -5, 10], [97, 82, 1.3, 23, -13, -8],
  [2, 46, 2, 17, -7, 13], [33, 13, 1.3, 25, -19, -10],
];

function AmbientLight({ focus = false }: { focus?: boolean }) {
  const points = focus ? LIGHT_PARTICLES.slice(0, 10).map((point, index) => [8 + index * 9.2, 18 + index % 4 * 8, ...point.slice(2)]) : LIGHT_PARTICLES;
  return <div className={`ambient-light-layer ${focus ? "ambient-focus" : ""}`} aria-hidden="true">
    <span className="atmosphere-halo halo-one" /><span className="atmosphere-halo halo-two" /><span className="atmosphere-halo halo-three" />
    <div className="light-particles">{points.map(([left, top, size, duration, delay, drift], index) => <i key={index} className="light-particle" style={{ left: `${left}%`, top: `${top}%`, width: `${size}px`, height: `${size}px`, "--particle-duration": `${duration}s`, "--particle-delay": `${delay}s`, "--particle-drift": `${drift}px` } as CSSProperties} />)}</div>
  </div>;
}

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function RadiantLight({ active = false, small = false }: { active?: boolean; small?: boolean }) {
  return <div className={`radiant-light ${active ? "radiant-active" : ""} ${small ? "radiant-small" : ""}`} aria-hidden="true">
    <div className="radiant-atmosphere" /><div className="radiant-rays" />
    <div className="radiant-petal petal-one" /><div className="radiant-petal petal-two" />
    <div className="radiant-petal petal-three" /><div className="radiant-petal petal-four" />
    <div className="radiant-heart"><span /></div>
    <div className="radiant-grain" /><span className="radiant-fleck fleck-one" />
    <span className="radiant-fleck fleck-two" /><span className="radiant-fleck fleck-three" />
  </div>;
}

function ErrorMessage({ session }: { session: Session }) {
  if (!session.error) return null;
  return <div className="error-message" role="alert">
    <p>{session.error}</p>
    {session.failedOperation && !session.busy && <button onClick={() => void session.retry()}><RotateCcw size={14} /> Try again</button>}
  </div>;
}

function WorkingState({ session, elapsed }: { session: Session; elapsed: number }) {
  const generating = session.phase === "meditation" || session.phase === "audio";
  const sampleJourney = isSampleView(session);
  if (!generating) return null;
  return <div className="working-state" role="status" aria-live="polite">
    <div className="working-title"><LoaderCircle size={17} className="spin" />
      <span>{session.phase === "meditation" ? sampleJourney ? "Opening the sample reflection" : "Finding the words for this moment" : sampleJourney ? "Bringing your sample audio into the room" : "Giving your reflection a voice"}</span>
      <span className="elapsed">{time(elapsed)} elapsed</span>
    </div>
    <ol className="working-steps" aria-label="Creation status">
      <li className="done"><Check size={13} /> {sampleJourney ? "Sample story" : "Your words"}</li>
      <li className={session.phase === "audio" ? "done" : "current"}>{session.phase === "audio" ? <Check size={13} /> : <span />} Reflection</li>
      <li className={session.phase === "audio" ? "current" : ""}><span /> Voice</li>
    </ol>
    <div className="working-note"><span>{sampleJourney ? "A pre-written fictional story and its matching audio." : session.phase === "audio" ? "Your written reflection is ready below. Audio can take a little longer." : "Keeping your needs and the words you chose at the center."}</span><button onClick={session.cancelWaiting}>Stop waiting</button></div>
  </div>;
}

interface TransportProps {
  ready: boolean; playing: boolean; duration: number; currentTime: number; focus?: boolean;
  toggle: () => void; seek: (value: number) => void; skip: (value: number) => void;
}
function Transport({ ready, playing, duration, currentTime, focus, toggle, seek, skip }: TransportProps) {
  const progress = duration ? Math.min(100, currentTime / duration * 100) : 0;
  const id = focus ? "focus-audio-seek" : "audio-seek";
  return <div className={`transport ${focus ? "transport-focus" : ""}`}>
    <div className="transport-buttons">
      <button className="skip-button" disabled={!ready} onClick={() => skip(-15)} aria-label="Skip back 15 seconds"><RotateCcw size={22} /><span>15</span></button>
      <button className="play-button" disabled={!ready} onClick={toggle} aria-label={playing ? "Pause reflection" : "Play reflection"}>{playing ? <Pause size={25} fill="currentColor" /> : <Play size={25} fill="currentColor" />}</button>
      <button className="skip-button" disabled={!ready} onClick={() => skip(15)} aria-label="Skip forward 15 seconds"><RotateCw size={22} /><span>15</span></button>
    </div>
    <div className="seek-control">
      <label className="sr-only" htmlFor={id}>Audio progress</label>
      <input id={id} type="range" min={0} max={duration || 1} step={0.1} value={Math.min(currentTime, duration || 1)} disabled={!ready}
        style={{ "--progress": `${progress}%` } as CSSProperties} onChange={event => seek(Number(event.target.value))} />
      <div className="seek-times"><span>{time(currentTime)}</span><span>{time(duration)}</span></div>
    </div>
  </div>;
}

export default function Home() {
  const session = useInnerlight();
  const audioRef = useRef<HTMLAudioElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousStep = useRef(session.step);
  const infoRef = useRef<HTMLDialogElement>(null);
  const focusRef = useRef<HTMLDialogElement>(null);
  const resetRef = useRef<HTMLDialogElement>(null);
  const ambienceRef = useRef<Ambience | null>(null);
  const ambienceEpoch = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [focusOpen, setFocusOpen] = useState(false);
  const [ambienceOn, setAmbienceOn] = useState(false);
  const [ambienceLoading, setAmbienceLoading] = useState(false);
  const [ambienceVolume, setAmbienceVolume] = useState(0.22);
  const [playbackError, setPlaybackError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const sample = isSampleView(session);
  const elapsed = session.phaseStartedAt ? Math.max(0, (now - session.phaseStartedAt) / 1000) : 0;

  useEffect(() => {
    if (!session.busy) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [session.busy, session.phaseStartedAt]);

  useEffect(() => {
    if (previousStep.current === session.step) return;
    previousStep.current = session.step;
    const frame = requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      if (window.innerWidth < 800) panelRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [session.step]);

  useEffect(() => {
    setPlaying(false); setDuration(0); setCurrentTime(0); setRate(1); setPlaybackError("");
    ambienceEpoch.current++;
    void ambienceRef.current?.stop(); ambienceRef.current = null;
    setAmbienceOn(false); setAmbienceLoading(false);
  }, [session.audioUrl]);

  useEffect(() => {
    ambienceRef.current?.setVolume(playing && ambienceOn ? ambienceVolume : 0);
  }, [playing, ambienceOn, ambienceVolume]);

  useEffect(() => {
    if (session.step !== 3) {
      audioRef.current?.pause(); setPlaying(false);
      focusRef.current?.close(); setFocusOpen(false);
      ambienceEpoch.current++;
      void ambienceRef.current?.stop(); ambienceRef.current = null;
      setAmbienceOn(false); setAmbienceLoading(false);
    }
  }, [session.step]);

  useEffect(() => () => { ambienceEpoch.current++; void ambienceRef.current?.stop(); }, []);

  async function togglePlay() {
    if (!audioRef.current) return;
    setPlaybackError("");
    if (!audioRef.current.paused) { audioRef.current.pause(); return; }
    try { await audioRef.current.play(); }
    catch { setPlaybackError("This browser couldn't play the audio. You can download it and listen in your preferred player."); }
  }
  function seek(value: number) {
    if (!audioRef.current || !Number.isFinite(duration)) return;
    const next = Math.min(duration, Math.max(0, value));
    audioRef.current.currentTime = next; setCurrentTime(next);
  }
  function changeRate(value: number) {
    setRate(value);
    if (audioRef.current) audioRef.current.playbackRate = value;
  }
  async function toggleAmbience() {
    if (ambienceLoading) return;
    if (ambienceOn) {
      ambienceEpoch.current++; void ambienceRef.current?.stop(); ambienceRef.current = null; setAmbienceOn(false); return;
    }
    const epoch = ++ambienceEpoch.current;
    setAmbienceLoading(true);
    try {
      const ambience = await createAmbience();
      if (epoch !== ambienceEpoch.current) { void ambience.stop(); return; }
      ambienceRef.current = ambience; ambience.setVolume(playing ? ambienceVolume : 0); setAmbienceOn(true);
    } catch (error) { if (epoch === ambienceEpoch.current) session.flash(error instanceof Error ? error.message : "Ambient sound is not available right now."); }
    finally { if (epoch === ambienceEpoch.current) setAmbienceLoading(false); }
  }
  function openSupport() {
    audioRef.current?.pause(); ambienceRef.current?.setVolume(0);
    if (!infoRef.current?.open) infoRef.current?.showModal();
    requestAnimationFrame(() => { const target = document.getElementById("support-options"); target?.scrollIntoView({ block: "center" }); target?.focus({ preventScroll: true }); });
  }
  function returnToWords() { audioRef.current?.pause(); session.goTo(1); }
  function requestNewMoment() {
    if (session.hasSession) { resetRef.current?.showModal(); return; }
    session.reset();
  }
  function newMoment() {
    audioRef.current?.pause(); ambienceEpoch.current++; void ambienceRef.current?.stop(); ambienceRef.current = null;
    setAmbienceOn(false); setAmbienceLoading(false); focusRef.current?.close(); resetRef.current?.close(); session.reset();
  }
  async function downloadCard() {
    if (!session.meditation || exporting) return;
    setExporting(true);
    try { downloadBlob(await createReminderPng(session.meditation), "innerlight-reminder.png"); session.flash("Your reminder image is ready to keep."); }
    catch (error) { session.flash(error instanceof Error ? error.message : "The image couldn't be created. You can still save your reminder as text."); }
    finally { setExporting(false); }
  }

  const transport = (focus = false) => <Transport ready={!!session.audioUrl} playing={playing} duration={duration} currentTime={currentTime} focus={focus} toggle={() => void togglePlay()} seek={seek} skip={seconds => seek(currentTime + seconds)} />;
  const listeningOptions = (focus = false) => <div className={`listening-options ${focus ? "listening-options-focus" : ""}`}>
    <label className="speed-control"><span>Playback speed</span><select aria-label="Playback speed" value={rate} disabled={!session.audioUrl} onChange={event => changeRate(Number(event.target.value))}><option value={0.75}>0.75×</option><option value={0.9}>0.9×</option><option value={1}>1×</option><option value={1.1}>1.1×</option><option value={1.25}>1.25×</option></select></label>
    <button className={`ambience-toggle ${ambienceOn ? "is-on" : ""}`} role="switch" aria-checked={ambienceOn} disabled={!session.audioUrl || ambienceLoading} onClick={() => void toggleAmbience()}>{ambienceLoading ? <LoaderCircle size={16} className="spin" /> : ambienceOn ? <Volume2 size={16} /> : <VolumeX size={16} />} Soft ambience <span className="switch-track"><i /></span></button>
    {ambienceOn && <label className="ambience-volume"><span className="sr-only">Ambient volume</span><input aria-label="Ambient volume" type="range" min={0} max={1} step={0.02} value={ambienceVolume} onChange={event => setAmbienceVolume(Number(event.target.value))} /></label>}
  </div>;

  return <main className={`innerlight-app stage-${session.step}`}>
    <AmbientLight />
    <a className="skip-link" href="#your-moment">Skip to your moment</a>
    <header className="site-header">
      <button className="brand" onClick={returnToWords} disabled={session.busy || session.recording} aria-label="Innerlight, return to your words"><span className="brand-mark"><Sun size={25} strokeWidth={1.15} /></span><span className="brand-wordmark">Innerlight<small>RETURN TO YOURSELF</small></span></button>
      <p className="header-note"><span aria-hidden="true">✧</span> A little light, just for you.</p>
      <div className="header-actions"><button onClick={() => infoRef.current?.showModal()} className="quiet-button"><Leaf size={15} /> About</button><button onClick={openSupport} className="quiet-button"><Heart size={15} /> Support</button></div>
    </header>

    <nav className="journey" aria-label="Your self-care journey"><ol>{[
      ["Speak", "Set it down"], ["Feel seen", "Make it your own"], ["Take it with you", "A little care to keep"],
    ].map(([name, description], index) => <li key={name} className={`${session.step === index + 1 ? "is-current" : ""} ${session.step > index + 1 ? "is-complete" : ""}`} aria-current={session.step === index + 1 ? "step" : undefined}><span className="journey-number">{session.step > index + 1 ? <Check size={14} /> : `0${index + 1}`}</span><span className="journey-label">{name}<small>{description}</small></span></li>)}</ol></nav>

    <div className="experience-layout">
      <aside className="intro-panel">
        <p className="eyebrow"><span /> A SPACE FOR SELF-COMPASSION</p>
        <h1 className="hero-title">{session.step === 1 ? <>Give love.<br />Include<br /><em>yourself.</em></> : session.step === 2 ? <>Your feelings<br />deserve<br /><em>room, too.</em></> : <>Let care<br />flow back<br /><em>to you.</em></>}</h1>
        <p className="intro-copy">{session.step === 1 ? <>For the part of you that gives so much.<br />A moment to hear what <em>you</em> need.</> : session.step === 2 ? <>Keep what feels true. Change what doesn&apos;t.<br />You get to tell your own story.</> : <>A little kindness. A choice that belongs to you.<br />Listening is enough. Action can wait.</>}</p>
        <div className="hero-light"><RadiantLight active={playing} /><p>There is room for you here.</p></div>
        <p className="intro-footnote"><Heart size={14} strokeWidth={1.4} /> Your worth doesn&apos;t need to be earned.</p>
      </aside>

      <section id="your-moment" className="experience-panel" ref={panelRef} aria-labelledby="moment-heading">
        <div className="panel-kicker"><span>{session.step === 1 ? "01 / SAY IT OUT LOUD" : session.step === 2 ? "02 / FEEL SEEN" : "03 / TAKE IT WITH YOU"}</span><span className={sample ? "source-tag sample" : "source-tag"}>{sample ? "Fictional sample" : session.step === 1 ? <><span className="status-dot" /> Your private moment</> : "Based on your words"}</span></div>

        {session.step === 1 && <>
          <div className="panel-heading"><h2 id="moment-heading" tabIndex={-1} ref={headingRef}>What have you<br className="desktop-heading-break" /> been carrying?</h2><p>No perfect words needed. Start with what&apos;s here.</p></div>
          <div className="mode-row"><div className="mode-switch" role="group" aria-label="Experience mode"><button aria-pressed={!sample} className={!sample ? "selected" : ""} disabled={session.busy || session.recording} onClick={() => session.chooseMode("live")}>Live session</button><button aria-pressed={sample} className={sample ? "selected" : ""} disabled={session.busy || session.recording} onClick={() => session.chooseMode("sample")}>Sample journey</button></div><div className="service-status">{sample ? "Pre-written story & audio" : session.statusLoading ? <><LoaderCircle size={12} className="spin" /> Checking connection</> : session.capability?.text ? <><span className="status-dot connected" /> {session.capability.audio ? "Text & voice ready" : "Text ready · Voice unavailable"}</> : <><span className="status-dot unavailable" /> Live service unavailable <button aria-label="Check service connection again" onClick={() => void session.refreshStatus()}><RotateCcw size={13} /></button></>}</div></div>
          <div className={`writing-space ${session.recording ? "is-recording" : ""}`}>
            <label className="field-eyebrow" htmlFor="your-words">YOUR WORDS</label>
            <textarea id="your-words" maxLength={2000} value={session.text} readOnly={sample} disabled={session.busy || session.recording} onChange={event => session.setText(event.target.value)} placeholder={"I've been making room for everyone's feelings.\nSomewhere along the way, I forgot about my own…"} />
            <div className="writing-toolbar">{sample ? <span className="sample-readonly"><Sparkles size={14} /> A pre-written starting point</span> : <button className={`record-button ${session.recording ? "is-recording" : ""}`} disabled={session.busy || (!session.recording && !session.capability?.asr)} onClick={() => void (session.recording ? session.finishRecording() : session.beginRecording())} title={!session.capability?.asr ? "Voice transcription is unavailable. You can write instead." : undefined}>{session.recording ? <Square size={13} fill="currentColor" /> : <Mic size={16} />}{session.recording ? "Finish recording" : "Or say it out loud"}</button>}<span className="character-count">{session.text.length.toLocaleString()} / 2,000</span></div>
          </div>
          {session.recording && <div className="recording-meter"><span className="recording-dot" /><span>Listening to your microphone</span><div className="voice-level" role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, session.recordLevel * 5) * 100)}><i style={{ width: `${Math.max(2, Math.min(1, session.recordLevel * 5) * 100)}%` }} /></div><span className="recording-time">{time(session.recordSeconds)} / 0:45</span></div>}
          {(session.phase === "record" || session.phase === "transcribe") && <div className="inline-status" role="status"><LoaderCircle size={16} className="spin" /> {session.phase === "record" ? "Opening your microphone. Please allow access in your browser." : "Putting your words on the page…"}<button onClick={session.cancelWaiting}>Stop waiting</button></div>}
          {sample && <p className="sample-note">This story, reflection, and audio are pre-made. Switch to Live session to use your own words; your live draft stays yours.</p>}
          <div className="sample-section"><p className="field-label">Explore a sample starting point</p><div className="sample-options">{sampleList.map((scenario, index) => <button key={scenario.id} disabled={session.busy || session.recording} aria-pressed={sample && session.scenarioId === scenario.id} className={sample && session.scenarioId === scenario.id ? "selected" : ""} onClick={() => session.chooseScenario(scenario.id)}>{index === 0 ? <Heart size={15} /> : index === 1 ? <Waves size={15} /> : <Sun size={15} />}<span>{scenario.label}</span>{sample && session.scenarioId === scenario.id && <Check size={13} />}</button>)}</div></div>
          <fieldset className="style-fieldset" disabled={session.busy || session.recording || sample}><legend>Words that feel like you</legend><div className="style-options"><button type="button" aria-pressed={sample || session.style === "everyday"} className={sample || session.style === "everyday" ? "selected" : ""} onClick={() => session.setStyle("everyday")}><Leaf size={16} /><span>Everyday words<small>Simple and grounded</small></span><span className="choice-dot" /></button><button type="button" aria-pressed={!sample && session.style === "spiritual"} className={!sample && session.style === "spiritual" ? "selected" : ""} onClick={() => session.setStyle("spiritual")}><Sparkles size={16} /><span>Light & nature<small>Gentle, optional imagery</small></span><span className="choice-dot" /></button></div></fieldset>
          <ErrorMessage session={session} />
          <button className="primary-button full-width" disabled={session.busy || session.recording || !session.text.trim() || (!sample && !session.capability?.text)} onClick={() => void session.reflect()}>{session.phase === "reflect" ? <><LoaderCircle size={18} className="spin" /> {sample ? "Opening the sample reflection…" : "Listening to what you shared…"}</> : <>{sample ? "Explore this sample" : "Help me hear myself"} <ArrowRight size={18} /></>}</button>
          {session.phase === "reflect" && <div className="request-note" role="status"><span>Making space for your words. <span className="elapsed">{time(elapsed)} elapsed</span></span><button onClick={session.cancelWaiting}>Stop waiting</button></div>}
          <p className="privacy-line"><ShieldCheck size={13} /> In this page, for this moment. <button onClick={() => infoRef.current?.showModal()}>How your words are handled</button></p>
          {session.meditation && <button className="resume-link" disabled={session.busy || session.recording} onClick={session.resumeResult}><Headphones size={14} /> Return to my last reflection <ArrowRight size={14} /></button>}
        </>}

        {session.step === 2 && session.reflection && <>
          <div className="panel-heading"><h2 id="moment-heading" tabIndex={-1} ref={headingRef}>{session.reflection.supportRequired ? "You don't have to carry this alone." : "Here's what I hear."}</h2><p>{session.reflection.supportRequired ? "Let real support have a place in this moment." : "Does this feel true? Make room for your own words."}</p></div>
          {session.reflection.supportRequired ? <div className="support-panel"><Heart size={30} strokeWidth={1.3} /><p>{session.reflection.summary}</p><p>Consider reaching out to someone you trust or a qualified mental health professional. If you are in immediate danger, contact local emergency services or ask someone you trust to stay with you now.</p><button className="secondary-button" onClick={openSupport}>Find a next step <ArrowRight size={16} /></button><button className="text-button" onClick={returnToWords}><ArrowLeft size={14} /> Return to your words</button></div> : <>
            <div className="reflection-quote"><span className="quotation-mark" aria-hidden="true">“</span><label className="sr-only" htmlFor="reflection-summary">{sample ? "Pre-written sample understanding" : "Our understanding of your words. You can edit this."}</label><textarea id="reflection-summary" ref={element => { if (element) { element.style.height = "auto"; element.style.height = `${element.scrollHeight}px`; } }} rows={4} maxLength={500} value={session.reflection.summary} readOnly={sample} disabled={session.busy} onChange={event => session.updateReflection({ summary: event.target.value })} /><span className="editable-note">{sample ? "Pre-written sample reflection" : "You can edit this understanding"}</span></div>
            <div className="feeling-row"><span className="field-label">What you may be feeling</span><span className="feeling-value">{session.reflection.feeling}</span></div>
            <div className="reflection-fields"><label className="reflection-field" htmlFor="reflection-need"><span><Leaf size={16} /> What I might need</span><textarea id="reflection-need" rows={2} maxLength={200} value={session.reflection.need} readOnly={sample} disabled={session.busy} onChange={event => session.updateReflection({ need: event.target.value })} /></label><div className="reflection-field"><div className="optional-label"><label htmlFor="reflection-belief"><Waves size={16} /> A demand I might soften <small>Optional</small></label>{!sample && session.reflection.belief && <button disabled={session.busy} onClick={() => session.updateReflection({ belief: "" })}>Skip this</button>}</div><textarea id="reflection-belief" aria-label="An optional demand to soften" rows={2} maxLength={200} placeholder="You can leave this blank. Nothing has to be solved here." value={session.reflection.belief} readOnly={sample} disabled={session.busy} onChange={event => session.updateReflection({ belief: event.target.value })} /></div></div>
            <p className="permission-note"><Sun size={18} strokeWidth={1.3} /> Needing care doesn't make your love any smaller.</p>
            <WorkingState session={session} elapsed={elapsed} /><ErrorMessage session={session} />
            <button className="primary-button full-width" disabled={session.busy || !session.reflection.summary.trim() || !session.reflection.need.trim()} onClick={() => void session.createMeditation()}>{session.phase === "meditation" ? <><LoaderCircle size={18} className="spin" /> {sample ? "Opening the sample…" : "Writing your reflection…"}</> : <><Headphones size={18} /> {sample ? "Continue to the sample audio" : session.capability?.audio ? "This feels right. Create my audio" : "This feels right. Create my reflection"} <ArrowRight size={18} /></>}</button>
            {!session.busy && <button className="back-button" onClick={() => session.goBack()}><ArrowLeft size={15} /> I'd like to say a little more</button>}
            <p className="small-permission">Keep only what feels true. You can always go back.</p>
          </>}
          {session.meditation && <button className="resume-link" disabled={session.busy || session.recording} onClick={session.resumeResult}><Headphones size={14} /> Return to my last reflection <ArrowRight size={14} /></button>}
        </>}

        {session.step === 3 && session.meditation && <>
          <div className="panel-heading result-heading"><p className="result-overline">A MOMENT THAT BELONGS TO YOU</p><h2 id="moment-heading" tabIndex={-1} ref={headingRef}>{session.meditation.title}</h2><p>Settle somewhere comfortable. There's nothing to get right.</p></div>
          {!session.resultIsCurrent && <aside className="previous-result-note" aria-label="Previous reflection"><Headphones size={15} /><p><strong>Previous reflection</strong><span>Your current words are still kept in this session.</span></p></aside>}
          <WorkingState session={session} elapsed={elapsed} />
          <div className={`audio-deck ${playing ? "is-playing" : ""}`}>
            <div className="audio-deck-heading"><div className="audio-art"><RadiantLight small active={playing} /></div><div><span className="audio-eyebrow">{sample ? "A FICTIONAL SAMPLE" : "PERSONALIZED REFLECTION"}</span><p>{session.audioUrl ? "A little room to listen." : "Your words are ready."}</p><span className="audio-source">AI-generated voice{duration > 0 ? ` · ${time(duration)}` : ""}</span></div>{session.audioUrl && <button className="focus-button" onClick={() => { focusRef.current?.showModal(); setFocusOpen(true); }} aria-label="Open focus listening view"><Maximize2 size={17} /><span>Focus</span></button>}</div>
            {transport()}
            {listeningOptions()}
            {ambienceOn && <p className="ambience-note">A quiet sound bed made in your browser. It joins only while your reflection plays.</p>}
          </div>
          {playbackError && <p className="error-message" role="alert">{playbackError}</p>}
          <ErrorMessage session={session} />
          {!session.audioUrl && session.phase !== "audio" && !session.failedOperation && <button className="secondary-button audio-retry" onClick={() => void session.retryAudio()}><Volume2 size={16} /> Prepare my audio</button>}
          <details className="script-details"><summary><FileText size={15} /> Read the full reflection <ChevronDown size={15} /></summary><div className="script-body">{session.meditation.script.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></details>
          <article className="reminder-card" aria-label="Your reminder to keep"><div className="reminder-corner" aria-hidden="true" /><div className="reminder-heading"><span><Sun size={15} /> A LITTLE LIGHT TO KEEP</span><span>INNERLIGHT</span></div><blockquote>{session.meditation.affirmation}</blockquote><div className="reminder-detail"><span>One small choice</span><p>{session.meditation.action}</p></div><div className="reminder-detail words"><span>Words you can borrow</span><p>“{session.meditation.boundary}”</p></div><div className="reminder-signature"><span>Innerlight</span><span>Care can flow both ways.</span></div></article>
          <div className="save-actions" aria-label="Save your reflection"><button className="secondary-button" onClick={() => void downloadCard()} disabled={exporting}>{exporting ? <LoaderCircle size={16} className="spin" /> : <ImageIcon size={16} />} Save card <span>PNG</span></button><button className="quiet-button" onClick={() => void session.copyTakeaway()}><Copy size={15} /> Copy</button><button className="quiet-button" onClick={session.downloadText}><FileText size={15} /> Text</button><button className="quiet-button" disabled={!session.audioBlob} onClick={session.downloadAudio}><Download size={15} /> Audio</button></div>
          <div className="return-note"><Leaf size={16} /><p>Listening is enough today.<br /><span>Action can wait until you're ready.</span></p></div>
          <div className="feedback-section"><p>{session.feedback ? session.feedback === "Not yet" ? "Thank you for being honest. You don't have to make this feel helpful." : "Thank you for sharing. Keep the part that feels like yours." : "Do you feel a little more heard?"}</p><div>{["A little", "Not yet"].map(answer => <button key={answer} className={session.feedback === answer ? "selected" : ""} aria-pressed={session.feedback === answer} onClick={() => session.setFeedback(answer)}>{session.feedback === answer && <CheckCheck size={14} />}{answer}</button>)}</div></div>
          <div className="result-navigation"><button className="text-button" disabled={session.busy} onClick={() => { audioRef.current?.pause(); session.goBack(); }}><ArrowLeft size={14} /> Revisit my reflection</button><button className="text-button" onClick={requestNewMoment}><RotateCcw size={14} /> Begin a new moment</button></div>
        </>}
      </section>
    </div>

    <footer className="site-footer"><div><span className="footer-dot" /><p>A self-care practice. Not a diagnosis or treatment.</p></div><div className="footer-links"><button onClick={openSupport}><Heart size={14} /> Need more support?</button><button onClick={() => infoRef.current?.showModal()}><ShieldCheck size={13} /> About & privacy</button></div><span className="footer-signature">A LITTLE CARE, CARRIED WITH YOU.</span></footer>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{session.step === 1 ? "Step 1. Speak." : session.step === 2 ? "Step 2. Feel seen." : "Step 3. Take it with you."}</div>
    {session.notice && <div className="toast" role="status"><Check size={16} /> {session.notice}</div>}

    {session.audioUrl && <audio ref={audioRef} src={session.audioUrl} preload="metadata" onLoadedMetadata={event => { setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); event.currentTarget.playbackRate = rate; }} onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); session.flash("Welcome back. Take the next moment slowly."); }} onError={() => setPlaybackError("This browser couldn't play the audio. You can download it and listen in your preferred player.")} />}

    <dialog className="focus-dialog" ref={focusRef} onClose={() => setFocusOpen(false)} aria-labelledby="focus-title">
      <div className="focus-inner"><AmbientLight focus /><div className="focus-topbar"><span className="focus-brand"><Sun size={20} strokeWidth={1.1} /> Innerlight</span><button onClick={() => focusRef.current?.close()} aria-label="Exit focus listening view"><X size={21} /> <span>Back to my moment</span></button></div>
        <div className="focus-content"><p className="focus-eyebrow">NOTHING TO PROVE. JUST A MOMENT TO BE.</p><div className="focus-light"><RadiantLight active={playing && focusOpen} /></div><h2 id="focus-title">{session.meditation?.title || "A little room for you"}</h2><p className="focus-description">Let the rest of the page wait.</p>{transport(true)}{listeningOptions(true)}{ambienceOn && <p className="focus-ambience-note">Ambient sound follows your playback. You can turn it off at any time.</p>}</div>
        <div className="focus-footer"><span>{sample ? "Fictional sample · AI-generated voice" : "Your personal reflection · AI-generated voice"}</span><button onClick={openSupport}><Heart size={14} /> Need support?</button></div>
      </div>
    </dialog>

    <dialog className="info-dialog" ref={infoRef} aria-labelledby="info-title" onClick={event => { if (event.target === event.currentTarget) infoRef.current?.close(); }}><div className="dialog-content"><button className="dialog-close" aria-label="Close information" onClick={() => infoRef.current?.close()}><X size={21} /></button><div className="dialog-mark"><Sun size={28} strokeWidth={1.15} /></div><p className="eyebrow">ABOUT THIS SPACE</p><h2 id="info-title">Give love.<br /><em>Include yourself.</em></h2><p>Innerlight is a space for self-care in the relationships that matter to you. Hear your feelings and needs. Accept support, express a boundary, or simply take a moment to be.</p><h3>Your words, on your terms</h3><p>In Live session mode, your text, recordings, and generated script are sent to Alibaba Cloud for reflection, transcription, and voice generation. The provider may process data under its own service policies.</p><p>This app uses your story and audio in the current page's memory. It does not write them to a long-term database. You decide whether to download them. Feedback also stays in this page session.</p><h3>Samples and sound</h3><p>Sample journeys use pre-written fictional stories, reflections, and synthesized audio. They are not personalized in real time. Optional ambience is made locally in your browser; it is not included in the downloaded narration.</p><h3>You always have a choice</h3><p>This is not diagnosis, therapy, or a message from a supernatural source. Light & nature is an optional style of imagery, not a promise to change a relationship or create a particular outcome. You can skip a prompt, stop listening, or leave at any time.</p><section className="support-info" aria-labelledby="support-options"><h3 id="support-options" tabIndex={-1}><Heart size={18} /> Need more support?</h3><p>You deserve support from people who can be there with you. Consider reaching out to someone you trust or a qualified mental health professional. Your school or community may also offer support.</p><p>If you are in immediate danger, contact local emergency services or ask someone you trust to stay with you right now.</p></section><button className="primary-button full-width" onClick={() => infoRef.current?.close()}>Return to my moment <ArrowRight size={17} /></button></div></dialog>

    <dialog className="reset-dialog" ref={resetRef} aria-labelledby="reset-title"><div className="dialog-content"><div className="dialog-mark"><Leaf size={25} strokeWidth={1.2} /></div><h2 id="reset-title">Begin a new moment?</h2><p>Your current reflection and audio will be cleared. Your own words will stay in your live draft. Download anything you'd like to keep first.</p><div className="reset-actions"><button className="secondary-button" onClick={() => resetRef.current?.close()}>Keep this moment</button><button className="primary-button" onClick={newMoment}>Begin anew <ArrowRight size={16} /></button></div></div></dialog>
  </main>;
}
