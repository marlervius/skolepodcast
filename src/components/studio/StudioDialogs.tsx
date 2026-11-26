"use client";

import {
  BookOpen, Check, Copy, ExternalLink, FileAudio, FileVideo, Link2, LoaderCircle,
  Plus, QrCode, Sparkles, Trash2, UploadCloud, X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { cleanNotebookFilename, parseNotebookStudyNotes } from "@/lib/notebooklm";
import { COURSE_COLORS, DEFAULT_COLOR, type Course, type Episode, type Topic } from "@/lib/types";
import { durationLabel, messageFrom, studioJson, studioRequest, uploadMedia } from "./api";
import { compressAudioForUpload, formatBytes, isWavFile } from "./audioCompress";

type DialogProps = {
  close: () => void;
  saved: (message: string, course?: Course) => void | Promise<void>;
};

function Dialog({
  title, close, busy = false, wide = false, children,
}: {
  title: string;
  close: () => void;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="studio-dialog-heading"
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
          <h2 id="studio-dialog-heading">{title}</h2>
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
        {children}
      </div>
    </dialog>
  );
}

function FormActions({
  busy, close, action, danger = false, disabled = false,
}: {
  busy: boolean;
  close: () => void;
  action: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="studio-dialog-actions">
      <button type="button" className="studio-button" onClick={close} disabled={busy}>Avbryt</button>
      <button
        type="submit"
        className={`studio-button ${danger ? "studio-button--danger" : "studio-button--primary"}`}
        disabled={busy || disabled}
      >
        {busy && <LoaderCircle size={16} className="studio-spinner" />}
        {action}
      </button>
    </div>
  );
}

function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function run(task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (failure) {
      setError(messageFrom(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return { busy, error, run };
}

export function CourseDialog({ course, close, saved }: DialogProps & { course?: Course }) {
  const { busy, error, run } = useSave();
  const [color, setColor] = useState<string>(course?.accent_color || DEFAULT_COLOR);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void run(async () => {
      const result = await studioRequest<{ course: Course }>(
        course ? `/api/courses/${course.id}` : "/api/courses",
        studioJson(course ? "PATCH" : "POST", { ...data, accent_color: color }),
      );
      await saved(course ? "Fagrommet er oppdatert." : "Fagrommet er opprettet.", result.course);
    });
  }

  return (
    <Dialog title={course ? "Rediger fagrom" : "Nytt fagrom"} busy={busy} close={close}>
      <form className="studio-form" onSubmit={submit}>
        <label>Tittel<input name="title" defaultValue={course?.title} placeholder="F.eks. Historie VG3" required maxLength={100} /></label>
        <div className="studio-form-row">
          <label>Fag<input name="subject" defaultValue={course?.subject} placeholder="Historie" required maxLength={80} /></label>
          <label>Klasse<input name="class_label" defaultValue={course?.class_label} placeholder="VG3" maxLength={40} /></label>
        </div>
        <label>Beskrivelse<textarea name="description" defaultValue={course?.description} rows={3} maxLength={1200} /></label>
        <label>
          NotebookLM-lenke <span className="studio-optional">valgfritt</span>
          <input name="notebook_url" type="url" defaultValue={course?.notebook_url} placeholder="https://notebooklm.google.com/notebook/…" maxLength={500} />
          <small>Gir deg én snarvei rett til notatboka der du lager podkaster og videoer for faget.</small>
        </label>
        <label>
          Klassekode <span className="studio-optional">{course ? "" : "valgfritt"}</span>
          <input name="code" className="studio-code-input" defaultValue={course?.code} placeholder="HIST-VG3" autoCapitalize="characters" maxLength={32} spellCheck={false} />
          {!course && <small>La feltet stå tomt for å få en automatisk kode.</small>}
        </label>
        <fieldset className="studio-colors">
          <legend>Fagfarge</legend>
          <div>
            {COURSE_COLORS.map(({ name, value }) => {
              const selected = color.toLowerCase() === value.toLowerCase();
              return (
                <label key={value} title={name} style={{ backgroundColor: value }}>
                  <input type="radio" name="color_choice" value={value} checked={selected} onChange={() => setColor(value)} aria-label={name} />
                  {selected && <Check size={17} aria-hidden="true" />}
                </label>
              );
            })}
          </div>
        </fieldset>
        {error && <p className="studio-error" role="alert">{error}</p>}
        <FormActions busy={busy} close={close} action={course ? "Lagre endringer" : "Opprett fagrom"} />
      </form>
    </Dialog>
  );
}

export function TopicDialog({ course, topic, close, saved }: DialogProps & { course: Course; topic?: Topic }) {
  const { busy, error, run } = useSave();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void run(async () => {
      await studioRequest(
        topic ? `/api/topics/${topic.id}` : `/api/courses/${course.id}/topics`,
        studioJson(topic ? "PATCH" : "POST", data),
      );
      await saved(topic ? "Kapittelet er oppdatert." : "Kapittelet er opprettet.");
    });
  }

  return (
    <Dialog title={topic ? "Rediger kapittel" : "Nytt kapittel"} busy={busy} close={close}>
      <form className="studio-form" onSubmit={submit}>
        <label>Tittel<input name="title" defaultValue={topic?.title} placeholder="F.eks. Mellomkrigstiden" required maxLength={100} /></label>
        <label>Beskrivelse<textarea name="description" defaultValue={topic?.description} rows={3} maxLength={1200} /></label>
        <label>
          NotebookLM-lenke <span className="studio-optional">valgfritt</span>
          <input name="notebook_url" type="url" defaultValue={topic?.notebook_url} placeholder="https://notebooklm.google.com/notebook/…" maxLength={500} />
          <small>Bruk denne hvis kapittelet har en egen notatbok i NotebookLM.</small>
        </label>
        {error && <p className="studio-error" role="alert">{error}</p>}
        <FormActions busy={busy} close={close} action={topic ? "Lagre endringer" : "Opprett kapittel"} />
      </form>
    </Dialog>
  );
}

const acceptedFiles = ".mp3,.m4a,.wav,.ogg,.aac,.flac,.mp4,.webm,.mov";
const audioExtensions = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;
const videoExtensions = /\.(mp4|webm|mov)$/i;

function readDuration(file: File) {
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

const currentMedia = {
  audio: { icon: FileAudio, label: "Lydfil" },
  video: { icon: FileVideo, label: "Videofil" },
  embed: { icon: Link2, label: "YouTube- eller Vimeo-video" },
} as const;

export function EpisodeDialog({
  course, topic, episode, initialFile, maxUploadMb, close, saved,
}: DialogProps & { course: Course; topic: Topic; episode?: Episode; initialFile?: File; maxUploadMb: number }) {
  const { busy, error, run } = useSave();
  const [replacing, setReplacing] = useState(false);
  const showMedia = !episode || replacing;
  const [mode, setMode] = useState<"file" | "link">("file");
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState("");
  const [compressWav, setCompressWav] = useState(true);
  const [title, setTitle] = useState(episode?.title || "");
  const [description, setDescription] = useState(episode?.description || "");
  const [studyNotes, setStudyNotes] = useState(episode?.study_notes || "");
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [rawPaste, setRawPaste] = useState("");
  const [pasteNotice, setPasteNotice] = useState("");
  const [lastFileTitle, setLastFileTitle] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState("");
  const filePicker = useRef<HTMLInputElement>(null);
  const duration = useRef<Promise<number>>(Promise.resolve(0));

  function chooseFile(selection: File) {
    setFileError("");
    if (!audioExtensions.test(selection.name) && !videoExtensions.test(selection.name)) {
      setFileError("Velg en lyd- eller videofil i et av formatene som er oppgitt.");
      return;
    }
    const maxRawBytes = isWavFile(selection) ? Math.max(maxUploadMb * 5, 250) * 1024 * 1024 : maxUploadMb * 1024 * 1024;
    if (selection.size > maxRawBytes) {
      setFileError(`Filen er for stor. Maks størrelse er ${maxUploadMb} MB. Lengre videoer kan legges på YouTube og lenkes inn.`);
      return;
    }
    setFile(selection);
    const filename = cleanNotebookFilename(selection.name);
    if (!title.trim() || title === lastFileTitle) setTitle(filename);
    setLastFileTitle(filename);
    duration.current = readDuration(selection);
  }

  useEffect(() => {
    if (initialFile) chooseFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  function applyNotebookPaste() {
    const parsed = parseNotebookStudyNotes(rawPaste);
    if (!parsed.description && !parsed.studyNotes) return;
    if (parsed.description && !description.trim()) setDescription(parsed.description);
    if (parsed.studyNotes) {
      setStudyNotes((prev) => (prev.trim() ? `${prev.trim()}\n\n${parsed.studyNotes}` : parsed.studyNotes));
    }
    setRawPaste("");
    setShowPasteBox(false);
    setPasteNotice("Fylt ut fra NotebookLM.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const uploading = showMedia && mode === "file";
    if (uploading && !file) {
      setFileError("Velg en fil for å fortsette.");
      return;
    }

    void run(async () => {
      try {
        let fields: Record<string, unknown> = {
          ...values,
          title,
          description,
          study_notes: studyNotes,
        };
        if (uploading && file) {
          let fileToUpload = file;
          let measuredDuration = 0;

          if (compressWav && isWavFile(file)) {
            setUploadStage("Komprimerer WAV-lyd fra NotebookLM …");
            setProgress(0);
            const result = await compressAudioForUpload(file, setUploadStage);
            fileToUpload = result.file;
            measuredDuration = result.durationSeconds;
            if (result.compressed) {
              setUploadStage(`Laster opp (${formatBytes(result.originalBytes)} → ${formatBytes(result.finalBytes)})`);
            } else {
              setUploadStage("Laster opp");
            }
          } else {
            setUploadStage("Laster opp");
            setProgress(0);
          }

          if (fileToUpload.size > maxUploadMb * 1024 * 1024) {
            throw new Error(`Filen er for stor (${formatBytes(fileToUpload.size)}). Maks størrelse er ${maxUploadMb} MB. Lengre videoer kan legges på YouTube og lenkes inn.`);
          }

          const uploadPath = await uploadMedia(fileToUpload, course.id, setProgress);
          const finalDuration = measuredDuration || (await duration.current);
          fields = { ...fields, upload_path: uploadPath, duration_seconds: finalDuration };
        }
        if (episode) {
          await studioRequest(`/api/episodes/${episode.id}`, studioJson("PATCH", fields));
        } else {
          await studioRequest("/api/episodes", studioJson("POST", { ...fields, course_id: course.id, topic_id: topic.id }));
        }
        await saved(episode ? "Episoden er oppdatert." : "Episoden er publisert.");
      } finally {
        setProgress(null);
        setUploadStage("");
      }
    });
  }

  function toggleReplace() {
    setReplacing((value) => !value);
    setFile(undefined);
    setFileError("");
    duration.current = Promise.resolve(0);
  }

  const FileIcon = file && videoExtensions.test(file.name) ? FileVideo : FileAudio;
  const current = episode ? currentMedia[episode.media_type] : null;
  const wavSelected = Boolean(file && isWavFile(file));

  const mediaFields = showMedia && (
    <>
      <div className="studio-mode-switch" role="group" aria-label="Mediekilde">
        <button type="button" aria-pressed={mode === "file"} disabled={busy} onClick={() => setMode("file")}><UploadCloud size={16} /> Last opp fil</button>
        <button type="button" aria-pressed={mode === "link"} disabled={busy} onClick={() => setMode("link")}><Link2 size={16} /> YouTube / Vimeo</button>
      </div>
      {mode === "file" ? (
        <>
          <div
            className={`studio-dropzone${dragging ? " studio-dropzone--active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const selected = event.dataTransfer.files[0];
              if (selected && !busy) chooseFile(selected);
            }}
          >
            <input
              hidden
              type="file"
              accept={acceptedFiles}
              ref={filePicker}
              disabled={busy}
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0];
                if (selected) chooseFile(selected);
                event.currentTarget.value = "";
              }}
            />
            {file ? <FileIcon size={27} /> : <UploadCloud size={27} />}
            <strong>{file ? `${file.name} (${formatBytes(file.size)})` : "Dra en lyd- eller videofil fra NotebookLM hit"}</strong>
            <button type="button" className="studio-button" disabled={busy} onClick={() => filePicker.current?.click()}>
              {file ? "Velg en annen fil" : "Velg fil"}
            </button>
            <small>MP3, M4A, WAV, OGG, AAC, FLAC, MP4, WEBM og MOV, maks {maxUploadMb} MB (WAV fra NotebookLM komprimeres automatisk).</small>
            {fileError && <p className="studio-error" role="alert">{fileError}</p>}
          </div>
          {wavSelected && (
            <label className="studio-nb-check">
              <input type="checkbox" checked={compressWav} disabled={busy} onChange={(e) => setCompressWav(e.target.checked)} />
              <span>
                <strong>Komprimer WAV til M4A før opplasting</strong>
                <small>Anbefalt for NotebookLM — krymper filen til en brøkdel og gjør strømming raskere for elevene.</small>
              </span>
            </label>
          )}
        </>
      ) : (
        <label>Videolenke<input name="embed_url" type="url" placeholder="https://www.youtube.com/watch?v=…" required /></label>
      )}
    </>
  );

  return (
    <Dialog title={episode ? "Rediger episode" : "Ny episode"} busy={busy} close={close}>
      <form className="studio-form" onSubmit={submit}>
        {!episode && mediaFields}
        <label>Tittel<input name="title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={140} /></label>
        {episode && (
          <label>
            Kapittel
            <select name="topic_id" defaultValue={episode.topic_id}>
              {course.topics.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
        )}

        <div className="studio-nb-paste-bar">
          <button
            type="button"
            className="studio-nb-link-btn"
            aria-expanded={showPasteBox}
            onClick={() => { setShowPasteBox((v) => !v); setPasteNotice(""); }}
          >
            <Sparkles size={15} /> {showPasteBox ? "Skjul NotebookLM-import" : "Lim inn studieguide / notater fra NotebookLM"}
          </button>
          {pasteNotice && <span className="studio-nb-copied">{pasteNotice}</span>}
        </div>
        {showPasteBox && (
          <div className="studio-nb-paste-box">
            <textarea
              rows={4}
              value={rawPaste}
              onChange={(e) => setRawPaste(e.target.value)}
              placeholder="Lim inn tekst fra Study Guide, Briefing Doc eller chatten i NotebookLM …"
            />
            <div className="studio-nb-paste-actions">
              <small>Markdown ryddes automatisk og fyller ut beskrivelse + nøkkelpunkter.</small>
              <button type="button" className="studio-button" disabled={!rawPaste.trim()} onClick={applyNotebookPaste}>
                Fyll ut automatisk
              </button>
            </div>
          </div>
        )}

        <label>Beskrivelse<textarea name="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1600} /></label>
        <label>Nøkkelpunkter og refleksjonsspørsmål<textarea name="study_notes" rows={4} value={studyNotes} onChange={(e) => setStudyNotes(e.target.value)} maxLength={8000} /></label>
        {episode && current && (
          <section className="studio-replace" aria-label="Lyd eller video">
            <div className="studio-replace-current">
              <current.icon size={18} aria-hidden />
              <span><small>Nå</small>{current.label}{episode.duration_seconds > 0 && ` · ${durationLabel(episode.duration_seconds)}`}</span>
              <button type="button" className="studio-button" aria-expanded={replacing} disabled={busy} onClick={toggleReplace}>
                {replacing ? "Behold nåværende" : "Bytt fil eller lenke"}
              </button>
            </div>
            {replacing && (
              <>
                {mediaFields}
                <p className="studio-muted">
                  Elevene beholder fremdriften sin i episoden.{episode.media_type !== "embed" && " Den gamle filen slettes når du lagrer."}
                </p>
              </>
            )}
          </section>
        )}
        {progress !== null && (
          <div className="studio-upload-progress" role="status">
            <span>{progress === 100 ? (episode ? "Lagrer endringene" : "Lagrer episoden") : (uploadStage || "Laster opp")}</span>
            <span>{progress} %</span>
            <progress value={progress} max={100} aria-label="Opplasting" />
          </div>
        )}
        {error && <p className="studio-error" role="alert">{error}</p>}
        <FormActions busy={busy} close={close} action={episode ? "Lagre endringer" : "Publiser episode"} />
      </form>
    </Dialog>
  );
}

export function ShareDialog({ course, close }: { course: Course; close: () => void }) {
  const [link, setLink] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "fallback">("idle");
  const linkField = useRef<HTMLInputElement>(null);
  const path = `/fag/${encodeURIComponent(course.code)}`;

  useEffect(() => setLink(new URL(path, window.location.origin).href), [path]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      linkField.current?.select();
      setCopyState(document.execCommand("copy") ? "copied" : "fallback");
    }
  }

  return (
    <Dialog title="Del med klassen" close={close} wide>
      <div className="studio-share">
        <div className="studio-share-description">
          <QrCode size={22} />
          <h3>{course.title}</h3>
          <p>Be elevene skanne koden med mobilkameraet eller skrive inn klassekoden i Lytterom.</p>
        </div>
        <div className="studio-qr">
          {link && <Image unoptimized src={`/api/qr?code=${encodeURIComponent(course.code)}`} width={256} height={256} alt={`QR-kode til ${course.title}`} />}
        </div>
        <div className="studio-share-code"><span>Klassekode</span><strong>{course.code}</strong></div>
        <label className="studio-share-link">Elevlenke<input ref={linkField} readOnly value={link} onFocus={(event) => event.currentTarget.select()} /></label>
        <div className="studio-share-actions">
          <button type="button" className="studio-button studio-button--primary" onClick={copy} disabled={!link}>
            {copyState === "copied" ? <Check size={16} /> : <Copy size={16} />}
            {copyState === "copied" ? "Lenke kopiert" : "Kopier elevlenke"}
          </button>
          <a className="studio-button" href={path} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Se som elev</a>
        </div>
        {copyState === "fallback" && <p role="status">Lenken er markert. Kopier den med tastaturet.</p>}
      </div>
    </Dialog>
  );
}

export function PreviewDialog({ episode, close }: { episode: Episode; close: () => void }) {
  const [error, setError] = useState(false);

  return (
    <Dialog title="Testavspilling" close={close} wide>
      <section className="studio-preview">
        <h3>{episode.title}</h3>
        {episode.description && <p>{episode.description}</p>}
        {episode.media_type === "audio" && <audio src={episode.media_url} controls preload="metadata" onError={() => setError(true)} />}
        {episode.media_type === "video" && <video src={episode.media_url} controls playsInline preload="metadata" onError={() => setError(true)} />}
        {episode.media_type === "embed" && (
          <iframe src={episode.embed_url} title={episode.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        )}
        {error && <p className="studio-error" role="alert">Nettleseren kunne ikke spille av denne filen.</p>}
        {episode.study_notes && (
          <div className="studio-preview-notes">
            <BookOpen size={18} />
            <div><strong>Nøkkelpunkter og refleksjonsspørsmål</strong><p>{episode.study_notes}</p></div>
          </div>
        )}
      </section>
    </Dialog>
  );
}

export function DeleteDialog({
  title, detail, kind, endpoint, close, saved,
}: DialogProps & { title: string; detail: string; kind: "fagrom" | "kapittel" | "episode"; endpoint: string }) {
  const { busy, error, run } = useSave();
  const result = { fagrom: "Fagrommet", kapittel: "Kapittelet", episode: "Episoden" }[kind];

  return (
    <Dialog title={`Slett ${kind}`} close={close} busy={busy}>
      <form className="studio-form" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await studioRequest(endpoint, { method: "DELETE" });
          await saved(`${result} er slettet.`);
        });
      }}>
        <p className="studio-delete-text"><Trash2 size={19} /><strong>{title}</strong></p>
        <p className="studio-delete-detail">{detail}</p>
        {error && <p className="studio-error" role="alert">{error}</p>}
        <FormActions busy={busy} close={close} action={`Slett ${kind}`} danger />
      </form>
    </Dialog>
  );
}

export function AddButton({ children, onClick, primary = false }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return <button className={`studio-button${primary ? " studio-button--primary" : ""}`} onClick={onClick}><Plus size={17} /> {children}</button>;
}
