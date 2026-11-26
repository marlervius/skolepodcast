"use client";

import {
  ArrowDown, ArrowLeft, ArrowUp, Check, Download, FileText, Headphones, Info,
  LoaderCircle, Mic, Plus, Sparkles, Trash2, Users, Volume2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  chunkPodcastTurns,
  estimateDurationSeconds,
  MAX_SOURCE_CHARS,
  parseDirectScript,
  PODCAST_LANGUAGES,
  PODCAST_LENGTHS,
  PODCAST_MODELS,
  PODCAST_VOICES,
  type PodcastFormat,
  type PodcastLanguage,
  type PodcastLength,
  type PodcastQuality,
  type PodcastScript,
  type PodcastTurn,
} from "@/lib/podcast";
import type { Course, Topic } from "@/lib/types";
import { durationLabel, messageFrom, studioJson, studioRequest, uploadMedia } from "./api";
import { compressAudioForUpload, formatBytes, pcmChunksToWavFile } from "./audioCompress";

type Step = "source" | "script" | "publish";

type GeneratedAudio = {
  file: File;
  url: string;
  durationSeconds: number;
  originalBytes: number;
  compressed: boolean;
};

const VOICE_SAMPLES: Record<PodcastLanguage, string> = {
  nb: "Hei! Slik høres stemmen min ut i en podkast i Lytterom.",
  nn: "Hei! Slik høyrest stemma mi ut i ein podkast i Lytterom.",
  en: "Hi! This is how my voice sounds in a Lytterom podcast.",
};

function sanitizeFilename(title: string) {
  const cleaned = title
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "podkast";
}

async function fetchTtsPcm(payload: object, signal?: AbortSignal): Promise<{ pcm: ArrayBuffer; sampleRate: number }> {
  const response = await fetch("/api/studio/podcast/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.error || "Kunne ikke generere lyd. Prøv igjen.");
  }
  const sampleRate = Number(response.headers.get("X-Audio-Sample-Rate")) || 24_000;
  const pcm = await response.arrayBuffer();
  return { pcm, sampleRate };
}

export function PodcastCreatorDialog({
  course,
  initialTopic,
  maxUploadMb,
  geminiConfigured,
  close,
  saved,
}: {
  course: Course;
  initialTopic?: Topic;
  maxUploadMb: number;
  geminiConfigured: boolean;
  close: () => void;
  saved: (message: string, changed?: Course) => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textPickerRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const voiceCacheRef = useRef<Map<string, string>>(new Map());
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  const [step, setStep] = useState<Step>("source");
  const [topicId, setTopicId] = useState(initialTopic?.id || course.topics[0]?.id || "");
  const [format, setFormat] = useState<PodcastFormat>("dialogue");
  const [language, setLanguage] = useState<PodcastLanguage>("nb");
  const [length, setLength] = useState<PodcastLength>("medium");
  const [quality, setQuality] = useState<PodcastQuality>("standard");
  const [hostAName, setHostAName] = useState("Nora");
  const [hostBName, setHostBName] = useState("Henrik");
  const [voiceA, setVoiceA] = useState("Kore");
  const [voiceB, setVoiceB] = useState("Puck");
  const [sourceText, setSourceText] = useState("");
  const [instructions, setInstructions] = useState("");

  // Manus-tilstand (Steg 2 & 3)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [studyNotes, setStudyNotes] = useState("");
  const [turns, setTurns] = useState<PodcastTurn[]>([]);
  const [showMetaInScript, setShowMetaInScript] = useState(false);

  // Generering & publisering
  const [busyMode, setBusyMode] = useState<"idle" | "script" | "tts" | "publish">("idle");
  const [statusLabel, setStatusLabel] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [testingVoice, setTestingVoice] = useState<"A" | "B" | null>(null);
  const [generated, setGenerated] = useState<GeneratedAudio | null>(null);

  const busy = busyMode !== "idle";

  useEffect(() => {
    const element = dialogRef.current;
    element?.showModal();
    return () => {
      abortRef.current?.abort();
      sampleAudioRef.current?.pause();
      for (const url of voiceCacheRef.current.values()) URL.revokeObjectURL(url);
      voiceCacheRef.current.clear();
      element?.close();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (generated?.url) URL.revokeObjectURL(generated.url);
    };
  }, [generated]);

  const activeTurns = useMemo(() => turns.filter((t) => t.text.trim().length > 0), [turns]);
  const ttsChunks = useMemo(() => chunkPodcastTurns(activeTurns), [activeTurns]);
  const estimatedSeconds = useMemo(() => estimateDurationSeconds(activeTurns), [activeTurns]);

  function replaceGenerated(next: GeneratedAudio | null) {
    setGenerated((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return next;
    });
  }

  function handleFormatChange(next: PodcastFormat) {
    setFormat(next);
    if (next === "solo" && hostAName === "Nora") setHostAName("Forteller");
    if (next === "dialogue" && hostAName === "Forteller") setHostAName("Nora");
  }

  async function loadTextFile(file: File) {
    setError("");
    if (file.size > 1_000_000) {
      setError("Tekstfilen er for stor (maks 1 MB).");
      return;
    }
    try {
      const content = await file.text();
      setSourceText(content.slice(0, MAX_SOURCE_CHARS));
      if (!title.trim()) {
        setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120));
      }
    } catch {
      setError("Kunne ikke lese tekstfilen.");
    }
  }

  async function auditionVoice(which: "A" | "B") {
    const voiceId = which === "A" ? voiceA : voiceB;
    const cacheKey = `${voiceId}:${language}:${quality}`;
    setError("");
    sampleAudioRef.current?.pause();

    const cachedUrl = voiceCacheRef.current.get(cacheKey);
    if (cachedUrl) {
      const audio = new Audio(cachedUrl);
      sampleAudioRef.current = audio;
      audio.play().catch(() => undefined);
      return;
    }

    setTestingVoice(which);
    try {
      const { pcm, sampleRate } = await fetchTtsPcm({
        format: "solo",
        quality,
        voice_a: voiceId,
        turns: [{ speaker: "A", text: VOICE_SAMPLES[language], style: "warm and natural" }],
      });
      const wav = pcmChunksToWavFile([pcm], sampleRate, `sample-${voiceId}`, 0);
      const url = URL.createObjectURL(wav);
      voiceCacheRef.current.set(cacheKey, url);
      const audio = new Audio(url);
      sampleAudioRef.current = audio;
      await audio.play().catch(() => undefined);
    } catch (failure) {
      setError(messageFrom(failure));
    } finally {
      setTestingVoice(null);
    }
  }

  async function generateScriptWithAi() {
    if (sourceText.trim().length < 20) {
      setError("Lim inn litt mer pensumtekst eller beskriv temaet tydeligere (minst 20 tegn).");
      return;
    }
    setError("");
    setBusyMode("script");
    setStatusLabel("Skriver podkastmanus med Gemini …");
    try {
      const result = await studioRequest<{ script: PodcastScript }>(
        "/api/studio/podcast/script",
        studioJson("POST", {
          course_id: course.id,
          topic_id: topicId,
          source_text: sourceText,
          format,
          language,
          length,
          host_a_name: hostAName,
          host_b_name: hostBName,
          instructions,
        }),
      );
      setTitle(result.script.title);
      setDescription(result.script.description);
      setStudyNotes(result.script.study_notes);
      setTurns(result.script.turns);
      replaceGenerated(null);
      setStep("script");
    } catch (failure) {
      setError(messageFrom(failure));
    } finally {
      setBusyMode("idle");
      setStatusLabel("");
    }
  }

  function useDirectScript() {
    setError("");
    const parsed = parseDirectScript(sourceText, format, hostAName, hostBName);
    const initialTurns = parsed.length
      ? parsed
      : [{ id: `turn-${Date.now()}-0`, speaker: "A" as const, text: "" }];
    if (!title.trim()) {
      const selectedTopic = course.topics.find((t) => t.id === topicId);
      setTitle(selectedTopic ? `Podkast: ${selectedTopic.title}` : "Ny podkastepisode");
    }
    setTurns(initialTurns);
    replaceGenerated(null);
    setStep("script");
  }

  function updateTurn(id: string, patch: Partial<PodcastTurn>) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addTurnAfter(index: number) {
    const current = turns[index];
    const nextSpeaker = format === "dialogue" ? (current?.speaker === "A" ? "B" : "A") : "A";
    const created: PodcastTurn = {
      id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      speaker: nextSpeaker,
      text: "",
    };
    setTurns((prev) => [...prev.slice(0, index + 1), created, ...prev.slice(index + 1)]);
  }

  function moveTurn(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= turns.length) return;
    setTurns((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }

  function removeTurn(id: string) {
    setTurns((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== id) : prev));
  }

  async function generateAudio() {
    if (!activeTurns.length) {
      setError("Skriv minst én replikk før du genererer lyd.");
      return;
    }
    const chunks = chunkPodcastTurns(activeTurns);
    const controller = new AbortController();
    abortRef.current = controller;

    setError("");
    setBusyMode("tts");
    setProgress(2);
    setStatusLabel(`Genererer del 1 av ${chunks.length} med Google TTS …`);

    try {
      const pcmBuffers: ArrayBuffer[] = [];
      let sampleRate = 24_000;

      for (let i = 0; i < chunks.length; i++) {
        setStatusLabel(`Genererer del ${i + 1} av ${chunks.length} med Google TTS …`);
        setProgress(Math.max(4, Math.round((i / chunks.length) * 82)));

        const result = await fetchTtsPcm(
          {
            format,
            quality,
            voice_a: voiceA,
            voice_b: voiceB,
            host_a_name: hostAName,
            host_b_name: hostBName,
            turns: chunks[i],
          },
          controller.signal,
        );
        sampleRate = result.sampleRate;
        pcmBuffers.push(result.pcm);
      }

      setProgress(88);
      setStatusLabel("Setter sammen og komprimerer lyd til M4A …");

      const baseFilename = sanitizeFilename(title || "podkast");
      const wavFile = pcmChunksToWavFile(pcmBuffers, sampleRate, `${baseFilename}.wav`, 220);
      const compressed = await compressAudioForUpload(wavFile, setStatusLabel);

      if (compressed.file.size > maxUploadMb * 1024 * 1024) {
        throw new Error(
          `Lydfilen ble større enn maksgrensen på ${maxUploadMb} MB (${formatBytes(compressed.file.size)}). Prøv å forkorte manuset litt.`,
        );
      }

      const url = URL.createObjectURL(compressed.file);
      const fallbackDuration = Math.round(
        pcmBuffers.reduce((sum, b) => sum + b.byteLength, 0) / (sampleRate * 2),
      );

      replaceGenerated({
        file: compressed.file,
        url,
        durationSeconds: compressed.durationSeconds || fallbackDuration,
        originalBytes: compressed.originalBytes,
        compressed: compressed.compressed,
      });

      setProgress(100);
      setStep("publish");
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") {
        setError("Lydgenereringen ble avbrutt.");
      } else {
        setError(messageFrom(failure));
      }
    } finally {
      abortRef.current = null;
      setBusyMode("idle");
      setStatusLabel("");
      setProgress(null);
    }
  }

  async function publishEpisode() {
    if (!generated) return;
    if (!topicId) {
      setError("Velg et kapittel å publisere episoden i.");
      return;
    }
    if (!title.trim()) {
      setError("Episoden trenger en tittel.");
      return;
    }

    setError("");
    setBusyMode("publish");
    setProgress(0);
    setStatusLabel("Laster opp lydfil …");

    try {
      const uploadPath = await uploadMedia(generated.file, course.id, setProgress);
      setStatusLabel("Lagrer episode …");
      await studioRequest(
        "/api/episodes",
        studioJson("POST", {
          course_id: course.id,
          topic_id: topicId,
          title: title.trim(),
          description: description.trim(),
          study_notes: studyNotes.trim(),
          upload_path: uploadPath,
          duration_seconds: generated.durationSeconds,
        }),
      );
      await saved("Podkasten er publisert.");
    } catch (failure) {
      setError(messageFrom(failure));
    } finally {
      setBusyMode("idle");
      setStatusLabel("");
      setProgress(null);
    }
  }

  const selectedTopic = course.topics.find((t) => t.id === topicId);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="podcast-creator-heading"
      className="studio-dialog studio-dialog--wide"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) close();
      }}
    >
      <div className="studio-dialog-body">
        <header className="studio-dialog-top">
          <div className="studio-pod-heading">
            <h2 id="podcast-creator-heading">Lag podkast</h2>
            <span className="studio-pod-powered">Google Gemini TTS</span>
          </div>
          <button
            type="button"
            className="studio-icon-button"
            onClick={close}
            disabled={busy}
            aria-label="Lukk"
          >
            <X size={20} />
          </button>
        </header>

        <nav className="studio-pod-steps" aria-label="Steg i podkastverktøyet">
          <button
            type="button"
            className={`studio-pod-step${step === "source" ? " studio-pod-step--active" : ""}`}
            disabled={busy}
            onClick={() => { setError(""); setStep("source"); }}
          >
            <span>1</span> Innhold
          </button>
          <button
            type="button"
            className={`studio-pod-step${step === "script" ? " studio-pod-step--active" : ""}`}
            disabled={busy || !turns.length}
            onClick={() => { setError(""); setStep("script"); }}
          >
            <span>2</span> Manus
          </button>
          <button
            type="button"
            className={`studio-pod-step${step === "publish" ? " studio-pod-step--active" : ""}`}
            disabled={busy || !generated}
            onClick={() => { setError(""); setStep("publish"); }}
          >
            <span>3</span> Lyd og publiser
          </button>
        </nav>

        {!geminiConfigured && (
          <div className="studio-pod-notice" role="status">
            <Info size={18} />
            <div>
              <strong>Mangler <code>GEMINI_API_KEY</code></strong>
              <p>
                Legg inn en nøkkel fra{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  Google AI Studio
                </a>{" "}
                i <code>.env.local</code> (eller miljøvariabler på Vercel) og start serveren på nytt for å generere manus og tale.
              </p>
            </div>
          </div>
        )}

        {/* ==================== STEG 1: INNHOLD & OPPSETT ==================== */}
        {step === "source" && (
          <div className="studio-form studio-pod-body">
            {course.topics.length > 0 && (
              <label>
                Kapittel
                <select value={topicId} disabled={busy} onChange={(e) => setTopicId(e.target.value)}>
                  {course.topics.map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="studio-mode-switch" role="group" aria-label="Podkastformat">
              <button
                type="button"
                aria-pressed={format === "dialogue"}
                disabled={busy}
                onClick={() => handleFormatChange("dialogue")}
              >
                <Users size={16} /> Samtale (2 verter)
              </button>
              <button
                type="button"
                aria-pressed={format === "solo"}
                disabled={busy}
                onClick={() => handleFormatChange("solo")}
              >
                <Mic size={16} /> Opplesning (1 stemme)
              </button>
            </div>

            <div className="studio-pod-grid-3">
              <label>
                Språk
                <select value={language} disabled={busy} onChange={(e) => setLanguage(e.target.value as PodcastLanguage)}>
                  {(Object.keys(PODCAST_LANGUAGES) as PodcastLanguage[]).map((key) => (
                    <option key={key} value={key}>{PODCAST_LANGUAGES[key].label}</option>
                  ))}
                </select>
              </label>
              <label>
                Lengde
                <select value={length} disabled={busy} onChange={(e) => setLength(e.target.value as PodcastLength)}>
                  {(Object.keys(PODCAST_LENGTHS) as PodcastLength[]).map((key) => (
                    <option key={key} value={key}>
                      {PODCAST_LENGTHS[key].label} ({PODCAST_LENGTHS[key].minutesLabel})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Lydkvalitet
                <select value={quality} disabled={busy} onChange={(e) => setQuality(e.target.value as PodcastQuality)}>
                  {(Object.keys(PODCAST_MODELS) as PodcastQuality[]).map((key) => (
                    <option key={key} value={key}>{PODCAST_MODELS[key].label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className={`studio-pod-voices${format === "solo" ? " studio-pod-voices--solo" : ""}`}>
              <div className="studio-pod-voice-card">
                <div className="studio-pod-voice-head">
                  <span className="studio-pod-badge studio-pod-badge--a">{format === "solo" ? "Oppleser" : "Vert 1"}</span>
                  <button
                    type="button"
                    className="studio-nb-link-btn"
                    disabled={busy || testingVoice !== null}
                    onClick={() => auditionVoice("A")}
                  >
                    {testingVoice === "A" ? <LoaderCircle size={14} className="studio-spinner" /> : <Volume2 size={14} />}
                    Prøvelytt
                  </button>
                </div>
                <div className="studio-pod-voice-fields">
                  <input
                    aria-label="Navn på vert 1"
                    value={hostAName}
                    maxLength={32}
                    disabled={busy}
                    onChange={(e) => setHostAName(e.target.value)}
                    placeholder={format === "solo" ? "Forteller" : "Nora"}
                  />
                  <select aria-label="Stemme for vert 1" value={voiceA} disabled={busy} onChange={(e) => setVoiceA(e.target.value)}>
                    {PODCAST_VOICES.map((voice) => (
                      <option key={voice.id} value={voice.id}>{voice.label} — {voice.tone}</option>
                    ))}
                  </select>
                </div>
              </div>

              {format === "dialogue" && (
                <div className="studio-pod-voice-card">
                  <div className="studio-pod-voice-head">
                    <span className="studio-pod-badge studio-pod-badge--b">Vert 2</span>
                    <button
                      type="button"
                      className="studio-nb-link-btn"
                      disabled={busy || testingVoice !== null}
                      onClick={() => auditionVoice("B")}
                    >
                      {testingVoice === "B" ? <LoaderCircle size={14} className="studio-spinner" /> : <Volume2 size={14} />}
                      Prøvelytt
                    </button>
                  </div>
                  <div className="studio-pod-voice-fields">
                    <input
                      aria-label="Navn på vert 2"
                      value={hostBName}
                      maxLength={32}
                      disabled={busy}
                      onChange={(e) => setHostBName(e.target.value)}
                      placeholder="Henrik"
                    />
                    <select aria-label="Stemme for vert 2" value={voiceB} disabled={busy} onChange={(e) => setVoiceB(e.target.value)}>
                      {PODCAST_VOICES.map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.label} — {voice.tone}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="studio-pod-source-wrap">
              <div className="studio-nb-paste-bar">
                <label htmlFor="podcast-source-text">Pensumtekst, notater eller tema</label>
                <input
                  hidden
                  ref={textPickerRef}
                  type="file"
                  accept=".txt,.md,.markdown"
                  onChange={(e) => {
                    const selected = e.currentTarget.files?.[0];
                    if (selected) void loadTextFile(selected);
                    e.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  className="studio-nb-link-btn"
                  disabled={busy}
                  onClick={() => textPickerRef.current?.click()}
                >
                  <FileText size={14} /> Last inn .txt / .md
                </button>
              </div>
              <textarea
                id="podcast-source-text"
                rows={7}
                maxLength={MAX_SOURCE_CHARS}
                disabled={busy}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="Lim inn undervisningsnotater, fagtekst, læringsmål — eller skriv et tema du vil lage en podkast om …"
              />
              <small className="studio-muted">
                {sourceText.length.toLocaleString("nb-NO")} / {MAX_SOURCE_CHARS.toLocaleString("nb-NO")} tegn
              </small>
            </div>

            <label>
              Ekstra instruksjon <span className="studio-optional">valgfritt</span>
              <input
                value={instructions}
                maxLength={800}
                disabled={busy}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="F.eks. «Forklar ekstra enkelt for 10. trinn, bruk eksempler fra hverdagen og avslutt med en oppsummering»"
              />
            </label>

            {error && <p className="studio-error" role="alert">{error}</p>}

            <div className="studio-pod-actions">
              <button
                type="button"
                className="studio-button"
                disabled={busy}
                onClick={useDirectScript}
              >
                Skriv manus selv
              </button>
              <button
                type="button"
                className="studio-button studio-button--primary"
                disabled={busy || !sourceText.trim()}
                onClick={generateScriptWithAi}
              >
                {busyMode === "script" ? <LoaderCircle size={16} className="studio-spinner" /> : <Sparkles size={16} />}
                {busyMode === "script" ? statusLabel : "Lag podkastmanus med AI"}
              </button>
            </div>
          </div>
        )}

        {/* ==================== STEG 2: REDIGER MANUS & GENERER LYD ==================== */}
        {step === "script" && (
          <div className="studio-form studio-pod-body">
            <label>
              Episodetittel
              <input
                value={title}
                maxLength={140}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Tittel på episoden"
              />
            </label>

            <div className="studio-nb-paste-bar">
              <button
                type="button"
                className="studio-nb-link-btn"
                aria-expanded={showMetaInScript}
                onClick={() => setShowMetaInScript((v) => !v)}
              >
                {showMetaInScript ? "Skjul beskrivelse og nøkkelpunkter" : "Rediger beskrivelse og nøkkelpunkter"}
              </button>
              <span className="studio-pod-stats">
                {activeTurns.length} {activeTurns.length === 1 ? "replikk" : "replikker"}
                {estimatedSeconds > 0 && ` · ca. ${durationLabel(estimatedSeconds)}`}
                {ttsChunks.length > 0 && ` · ${ttsChunks.length} ${ttsChunks.length === 1 ? "lydbolk" : "lydbolker"}`}
              </span>
            </div>

            {showMetaInScript && (
              <div className="studio-nb-paste-box">
                <label>
                  Beskrivelse
                  <textarea
                    rows={2}
                    maxLength={1600}
                    disabled={busy}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <label>
                  Nøkkelpunkter og refleksjonsspørsmål
                  <textarea
                    rows={4}
                    maxLength={8000}
                    disabled={busy}
                    value={studyNotes}
                    onChange={(e) => setStudyNotes(e.target.value)}
                  />
                </label>
              </div>
            )}

            <div className="studio-pod-turns">
              {turns.map((turn, index) => {
                const isB = format === "dialogue" && turn.speaker === "B";
                const speakerLabel = isB ? (hostBName || "Vert 2") : (hostAName || "Vert 1");
                return (
                  <div key={turn.id} className={`studio-pod-turn${isB ? " studio-pod-turn--b" : ""}`}>
                    <div className="studio-pod-turn-head">
                      {format === "dialogue" ? (
                        <button
                          type="button"
                          className={`studio-pod-badge studio-pod-badge--btn ${isB ? "studio-pod-badge--b" : "studio-pod-badge--a"}`}
                          disabled={busy}
                          title="Klikk for å bytte taler"
                          onClick={() => updateTurn(turn.id, { speaker: isB ? "A" : "B" })}
                        >
                          {speakerLabel}
                        </button>
                      ) : (
                        <span className="studio-pod-badge studio-pod-badge--a">{speakerLabel}</span>
                      )}
                      <div className="studio-row-actions">
                        <button
                          type="button"
                          className="studio-icon-button"
                          disabled={busy || index === 0}
                          onClick={() => moveTurn(index, -1)}
                          aria-label="Flytt replikk opp"
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          className="studio-icon-button"
                          disabled={busy || index === turns.length - 1}
                          onClick={() => moveTurn(index, 1)}
                          aria-label="Flytt replikk ned"
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          type="button"
                          className="studio-icon-button"
                          disabled={busy}
                          onClick={() => addTurnAfter(index)}
                          aria-label="Legg til replikk under"
                          title="Legg til replikk under"
                        >
                          <Plus size={15} />
                        </button>
                        <button
                          type="button"
                          className="studio-icon-button"
                          disabled={busy || turns.length <= 1}
                          onClick={() => removeTurn(turn.id)}
                          aria-label="Slett replikk"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={Math.min(5, Math.max(2, Math.ceil(turn.text.length / 95)))}
                      disabled={busy}
                      value={turn.text}
                      maxLength={1800}
                      onChange={(e) => updateTurn(turn.id, { text: e.target.value })}
                      placeholder="Skriv det som skal leses høyt …"
                    />
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="studio-button"
              disabled={busy}
              onClick={() => addTurnAfter(turns.length - 1)}
            >
              <Plus size={16} /> Legg til replikk
            </button>

            {progress !== null && busyMode === "tts" && (
              <div className="studio-upload-progress" role="status">
                <span>{statusLabel}</span>
                <span>{progress} %</span>
                <progress value={progress} max={100} aria-label="Lydgenerering" />
              </div>
            )}

            {error && <p className="studio-error" role="alert">{error}</p>}

            <div className="studio-pod-actions">
              {busyMode === "tts" ? (
                <button
                  type="button"
                  className="studio-button"
                  onClick={() => abortRef.current?.abort()}
                >
                  Avbryt generering
                </button>
              ) : (
                <button
                  type="button"
                  className="studio-button"
                  disabled={busy}
                  onClick={() => { setError(""); setStep("source"); }}
                >
                  <ArrowLeft size={16} /> Tilbake
                </button>
              )}
              <button
                type="button"
                className="studio-button studio-button--primary"
                disabled={busy || !activeTurns.length}
                onClick={generateAudio}
              >
                {busyMode === "tts" ? <LoaderCircle size={16} className="studio-spinner" /> : <Headphones size={16} />}
                {busyMode === "tts" ? "Genererer lyd …" : "Generer lyd med Google TTS"}
              </button>
            </div>
          </div>
        )}

        {/* ==================== STEG 3: FORHÅNDSLYTT & PUBLISER ==================== */}
        {step === "publish" && generated && (
          <div className="studio-form studio-pod-body">
            <div className="studio-pod-player-card">
              <div className="studio-pod-player-meta">
                <div>
                  <strong>Lydfilen er klar!</strong>
                  <small>
                    {durationLabel(generated.durationSeconds)} · {formatBytes(generated.file.size)}
                    {generated.compressed && ` (komprimert fra ${formatBytes(generated.originalBytes)})`}
                    {selectedTopic && ` · Kapittel: ${selectedTopic.title}`}
                  </small>
                </div>
                <a
                  className="studio-button"
                  href={generated.url}
                  download={generated.file.name}
                >
                  <Download size={15} /> Last ned
                </a>
              </div>
              <audio src={generated.url} controls preload="metadata" />
            </div>

            <div className="studio-form-row">
              <label>
                Episodetittel
                <input
                  value={title}
                  maxLength={140}
                  disabled={busy}
                  required
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Kapittel
                <select value={topicId} disabled={busy} onChange={(e) => setTopicId(e.target.value)}>
                  {course.topics.map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              Beskrivelse
              <textarea
                rows={2}
                maxLength={1600}
                disabled={busy}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <label>
              Nøkkelpunkter og refleksjonsspørsmål
              <textarea
                rows={4}
                maxLength={8000}
                disabled={busy}
                value={studyNotes}
                onChange={(e) => setStudyNotes(e.target.value)}
              />
            </label>

            {progress !== null && busyMode === "publish" && (
              <div className="studio-upload-progress" role="status">
                <span>{statusLabel}</span>
                <span>{progress} %</span>
                <progress value={progress} max={100} aria-label="Opplasting" />
              </div>
            )}

            {error && <p className="studio-error" role="alert">{error}</p>}

            <div className="studio-pod-actions">
              <button
                type="button"
                className="studio-button"
                disabled={busy}
                onClick={() => { setError(""); setStep("script"); }}
              >
                <ArrowLeft size={16} /> Endre manus
              </button>
              <button
                type="button"
                className="studio-button studio-button--primary"
                disabled={busy || !title.trim() || !topicId}
                onClick={publishEpisode}
              >
                {busyMode === "publish" ? <LoaderCircle size={16} className="studio-spinner" /> : <Check size={16} />}
                {busyMode === "publish" ? "Publiserer …" : "Publiser episode"}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
