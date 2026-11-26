"use client";

import {
  Check, Copy, ExternalLink, FileAudio, FileVideo, KeyRound, LoaderCircle,
  Puzzle, Sparkles, Trash2, UploadCloud, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cleanNotebookFilename, NOTEBOOKLM_PROMPTS } from "@/lib/notebooklm";
import type { Course, Topic } from "@/lib/types";
import { messageFrom, studioJson, studioRequest, uploadMedia } from "./api";
import { compressAudioForUpload, formatBytes, isWavFile } from "./audioCompress";

const videoExtensions = /\.(mp4|webm|mov)$/i;

function readMediaDuration(file: File) {
  return new Promise<number>((resolve) => {
    const element = document.createElement(videoExtensions.test(file.name) ? "video" : "audio");
    const source = URL.createObjectURL(file);
    let finished = false;
    const timer = window.setTimeout(() => complete(0), 5000);
    function complete(seconds: number) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(source);
      resolve(Number.isFinite(seconds) ? Math.round(seconds) : 0);
    }
    element.preload = "metadata";
    element.onloadedmetadata = () => complete(element.duration);
    element.onerror = () => complete(0);
    element.src = source;
  });
}

function Modal({
  title, close, busy = false, wide = false, children,
}: {
  title: string;
  close: () => void;
  busy?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="nb-dialog-heading"
      className={`studio-dialog${wide ? " studio-dialog--wide" : ""}`}
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
          <h2 id="nb-dialog-heading">{title}</h2>
          <button type="button" className="studio-icon-button" onClick={close} disabled={busy} aria-label="Lukk">
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

/* ---------- NotebookLM-verktøykasse (prompts + Chrome-utvidelse) ---------- */

export function NotebookToolkitDialog({
  course, initialTopicId, close, onEditCourse,
}: {
  course: Course;
  initialTopicId?: string;
  close: () => void;
  onEditCourse: () => void;
}) {
  const [tab, setTab] = useState<"prompts" | "extension">("prompts");
  const [topicId, setTopicId] = useState(initialTopicId || course.topics[0]?.id || "");
  const [copiedId, setCopiedId] = useState("");
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [tokenCopied, setTokenCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const selectedTopic = course.topics.find((item) => item.id === topicId);
  const notebookUrl = selectedTopic?.notebook_url || course.notebook_url || "https://notebooklm.google.com";
  const hasLinkedNotebook = Boolean(selectedTopic?.notebook_url || course.notebook_url);

  async function copyPrompt(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? "" : prev)), 2200);
    } catch {
      /* Fallback: brukeren kan markere teksten manuelt. */
    }
  }

  async function generateToken() {
    setTokenBusy(true);
    setTokenError("");
    setTokenCopied(false);
    try {
      const result = await studioRequest<{ token: string }>("/api/auth/token", studioJson("POST", {}));
      setToken(result.token);
      try {
        await navigator.clipboard.writeText(result.token);
        setTokenCopied(true);
      } catch {
        /* Vises i feltet nedenfor uansett. */
      }
    } catch (failure) {
      setTokenError(messageFrom(failure));
    } finally {
      setTokenBusy(false);
    }
  }

  return (
    <Modal title="NotebookLM-integrasjon" close={close} wide>
      <div className="studio-nb">
        <div className="studio-nb-hero">
          <div>
            <strong>{hasLinkedNotebook ? "Koblet til NotebookLM" : "Lag podkaster og videoer i NotebookLM"}</strong>
            <p>
              {hasLinkedNotebook
                ? "Åpne notatboka, lag episoden og send den rett hit — enten med Chrome-utvidelsen eller ved å dra filen rett inn i et kapittel."
                : "Du kan lagre lenken til din NotebookLM-notatbok på fagrommet eller på hvert kapittel for rask tilgang."}
            </p>
          </div>
          <div className="studio-nb-hero-actions">
            <a className="studio-button studio-button--primary" href={notebookUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> {hasLinkedNotebook ? "Åpne notatbok" : "Åpne NotebookLM"}
            </a>
            {!hasLinkedNotebook && (
              <button type="button" className="studio-button" onClick={onEditCourse}>
                Koble notatbok
              </button>
            )}
          </div>
        </div>

        <div className="studio-mode-switch" role="tablist" aria-label="NotebookLM-verktøy">
          <button type="button" role="tab" aria-pressed={tab === "prompts"} onClick={() => setTab("prompts")}>
            <Sparkles size={16} /> Maler til NotebookLM
          </button>
          <button type="button" role="tab" aria-pressed={tab === "extension"} onClick={() => setTab("extension")}>
            <Puzzle size={16} /> Chrome-utvidelse
          </button>
        </div>

        {tab === "prompts" ? (
          <div className="studio-nb-section">
            {course.topics.length > 0 && (
              <label className="studio-nb-picker">
                <span>Tilpass malene til kapittel</span>
                <select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
                  <option value="">Hele faget ({course.title})</option>
                  {course.topics.map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="studio-nb-prompts">
              {NOTEBOOKLM_PROMPTS.map((template) => {
                const text = template.build({
                  courseTitle: course.title,
                  subject: course.subject,
                  classLabel: course.class_label,
                  topicTitle: selectedTopic?.title,
                });
                const isCopied = copiedId === template.id;
                return (
                  <article key={template.id} className="studio-nb-card">
                    <div className="studio-nb-card-head">
                      <div>
                        <span className="studio-nb-badge">{template.where}</span>
                        <h3>{template.label}</h3>
                        <p>{template.summary}</p>
                      </div>
                      <button type="button" className="studio-button" onClick={() => copyPrompt(template.id, text)}>
                        {isCopied ? <Check size={15} /> : <Copy size={15} />}
                        {isCopied ? "Kopiert" : "Kopier"}
                      </button>
                    </div>
                    <pre className="studio-nb-pre">{text}</pre>
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="studio-nb-section">
            <div className="studio-nb-steps">
              <h3>Send episoder rett fra NotebookLM med ett klikk</h3>
              <p className="studio-muted">
                Chrome-utvidelsen legger til en «Send til Lytterom»-knapp direkte på <code>notebooklm.google.com</code>.
                Den fanger opp lyd- og videooversikter, komprimerer WAV automatisk og lar deg publisere rett til riktig fagrom og kapittel.
              </p>
              <ol>
                <li>Åpne <code>chrome://extensions</code> i Chrome eller Edge og slå på <strong>Utviklermodus</strong>.</li>
                <li>Klikk <strong>Last inn upakket</strong> og velg mappen <code>extension</code> fra Lytterom-prosjektet.</li>
                <li>Lag en tilkoblingsnøkkel nedenfor og lim den inn i utvidelsen sammen med serveradressen.</li>
              </ol>
            </div>

            <div className="studio-nb-token-box">
              <div className="studio-nb-token-row">
                <div>
                  <strong>Tilkoblingsnøkkel for utvidelsen</strong>
                  <small>Gyldig i 30 dager. Hold nøkkelen privat — den gir tilgang til din lærerkonto.</small>
                </div>
                <button type="button" className="studio-button studio-button--primary" disabled={tokenBusy} onClick={generateToken}>
                  {tokenBusy ? <LoaderCircle size={16} className="studio-spinner" /> : <KeyRound size={16} />}
                  {token ? "Lag ny nøkkel" : "Lag og kopier nøkkel"}
                </button>
              </div>
              {tokenError && <p className="studio-error" role="alert">{tokenError}</p>}
              {token && (
                <div className="studio-nb-token-fields">
                  <label>
                    Serveradresse
                    <input readOnly value={origin} onFocus={(e) => e.currentTarget.select()} />
                  </label>
                  <label>
                    Tilkoblingsnøkkel {tokenCopied && <span className="studio-nb-copied">Kopiert til utklippstavlen</span>}
                    <input readOnly value={token} onFocus={(e) => e.currentTarget.select()} />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------- Masseimport av flere filer sluppet på et kapittel ---------- */

type BatchItem = {
  id: string;
  file: File;
  title: string;
  status: "ready" | "compressing" | "uploading" | "done" | "error";
  progress: number;
  note: string;
};

export function NotebookBatchImportDialog({
  course, topic, files, maxUploadMb, close, saved,
}: {
  course: Course;
  topic: Topic;
  files: File[];
  maxUploadMb: number;
  close: () => void;
  saved: (message: string) => void | Promise<void>;
}) {
  const [items, setItems] = useState<BatchItem[]>(() =>
    files.map((file, idx) => ({
      id: `${idx}-${file.name}-${file.size}`,
      file,
      title: cleanNotebookFilename(file.name) || file.name,
      status: "ready",
      progress: 0,
      note: "",
    })),
  );
  const [compressWav, setCompressWav] = useState(true);
  const [busy, setBusy] = useState(false);
  const hasWav = items.some((item) => isWavFile(item.file));

  function updateItem(id: string, patch: Partial<BatchItem>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function publishAll() {
    if (busy || !items.length) return;
    setBusy(true);
    let published = 0;

    for (const item of items) {
      if (item.status === "done") {
        published++;
        continue;
      }
      const cleanTitle = item.title.trim() || cleanNotebookFilename(item.file.name) || "Ny episode";
      try {
        let uploadFile = item.file;
        let duration = 0;
        let savedNote = "";

        if (compressWav && isWavFile(uploadFile)) {
          updateItem(item.id, { status: "compressing", note: "Komprimerer WAV til M4A …" });
          const result = await compressAudioForUpload(uploadFile, (label) => {
            updateItem(item.id, { note: label });
          });
          uploadFile = result.file;
          duration = result.durationSeconds;
          if (result.compressed) {
            savedNote = `${formatBytes(result.originalBytes)} → ${formatBytes(result.finalBytes)}`;
          }
        }

        if (uploadFile.size > maxUploadMb * 1024 * 1024) {
          throw new Error(`For stor (${formatBytes(uploadFile.size)}, maks ${maxUploadMb} MB).`);
        }

        if (!duration) duration = await readMediaDuration(uploadFile);

        updateItem(item.id, { status: "uploading", progress: 0, note: savedNote || "Laster opp …" });
        const uploadPath = await uploadMedia(uploadFile, course.id, (percent) => {
          updateItem(item.id, { progress: percent });
        });

        await studioRequest("/api/episodes", studioJson("POST", {
          course_id: course.id,
          topic_id: topic.id,
          title: cleanTitle,
          description: "",
          study_notes: "",
          upload_path: uploadPath,
          duration_seconds: duration,
        }));

        published++;
        updateItem(item.id, {
          status: "done",
          progress: 100,
          note: savedNote ? `Publisert (${savedNote})` : "Publisert",
        });
      } catch (failure) {
        updateItem(item.id, { status: "error", note: messageFrom(failure) });
      }
    }

    setBusy(false);
    if (published === items.length) {
      await saved(`${published} episoder er publisert i «${topic.title}».`);
    }
  }

  return (
    <Modal title={`Importer til «${topic.title}»`} busy={busy} close={close} wide>
      <div className="studio-form">
        <p className="studio-muted" style={{ marginTop: 0 }}>
          Juster titlene om ønskelig før du publiserer. Alle episodene legges nederst i kapittelet.
        </p>

        {hasWav && (
          <label className="studio-nb-check">
            <input type="checkbox" checked={compressWav} disabled={busy} onChange={(e) => setCompressWav(e.target.checked)} />
            <span>
              <strong>Komprimer WAV-lyd automatisk til M4A</strong>
              <small>Anbefalt for NotebookLM — krymper store WAV-filer og gjør strømming mye raskere.</small>
            </span>
          </label>
        )}

        <ul className="studio-nb-batch">
          {items.map((item) => {
            const Icon = videoExtensions.test(item.file.name) ? FileVideo : FileAudio;
            return (
              <li key={item.id} className={`studio-nb-batch-item studio-nb-batch-item--${item.status}`}>
                <span className="studio-episode-icon"><Icon size={18} /></span>
                <div className="studio-nb-batch-body">
                  <input
                    value={item.title}
                    disabled={busy || item.status === "done"}
                    maxLength={140}
                    aria-label={`Tittel for ${item.file.name}`}
                    onChange={(e) => updateItem(item.id, { title: e.target.value })}
                  />
                  <small>
                    {item.file.name} · {formatBytes(item.file.size)}
                    {isWavFile(item.file) && compressWav && item.status === "ready" ? " · Komprimeres før opplasting" : ""}
                    {item.note ? ` · ${item.note}` : ""}
                  </small>
                  {item.status === "uploading" && (
                    <progress value={item.progress} max={100} aria-label="Opplasting" />
                  )}
                </div>
                {item.status === "done" ? (
                  <span className="studio-nb-done" aria-label="Publisert"><Check size={18} /></span>
                ) : (
                  <button
                    type="button"
                    className="studio-icon-button"
                    disabled={busy || items.length <= 1}
                    onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
                    aria-label="Fjern fra listen"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="studio-dialog-actions">
          <button type="button" className="studio-button" onClick={close} disabled={busy}>Avbryt</button>
          <button type="button" className="studio-button studio-button--primary" disabled={busy || !items.length} onClick={publishAll}>
            {busy ? <LoaderCircle size={16} className="studio-spinner" /> : <UploadCloud size={16} />}
            Publiser {items.length} {items.length === 1 ? "episode" : "episoder"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
