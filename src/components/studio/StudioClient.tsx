"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowDown, ArrowUp, BookOpen, Eye, FileAudio, FileVideo, Headphones, LoaderCircle, LogOut, Pencil,
  QrCode, Trash2, Youtube,
} from "lucide-react";
import type { Course, CourseSummary, Episode, Teacher, Topic } from "@/lib/types";
import { durationLabel, messageFrom, studioJson, studioRequest } from "./api";
import { AddButton, CourseDialog, DeleteDialog, EpisodeDialog, PreviewDialog, ShareDialog, TopicDialog } from "./StudioDialogs";

type DialogState =
  | { kind: "course"; course?: Course }
  | { kind: "topic"; topic?: Topic }
  | { kind: "episode"; topic: Topic; episode?: Episode }
  | { kind: "share" }
  | { kind: "preview"; episode: Episode }
  | { kind: "delete"; title: string; detail: string; target: "fagrom" | "kapittel" | "episode"; endpoint: string };

const SELECTED_KEY = "lytterom_studio_course_v1";

export function StudioClient() {
  const [teacher, setTeacher] = useState<Teacher | null | undefined>(undefined);

  useEffect(() => {
    studioRequest<{ teacher: Teacher | null }>("/api/auth/me")
      .then((result) => setTeacher(result.teacher))
      .catch(() => setTeacher(null));
  }, []);

  if (teacher === undefined) {
    return <div className="studio-loading"><LoaderCircle className="studio-spinner" size={26} /> Laster studio …</div>;
  }
  if (!teacher) return <AuthScreen onAuthenticated={setTeacher} />;
  return <Studio teacher={teacher} onLogout={() => setTeacher(null)} />;
}

/* ---------- Innlogging og registrering ---------- */

// I produksjon krever nye lærerkontoer invitasjonskode.
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function AuthScreen({ onAuthenticated }: { onAuthenticated: (teacher: Teacher) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      const result = await studioRequest<{ teacher: Teacher }>(`/api/auth/${mode}`, studioJson("POST", data));
      onAuthenticated(result.teacher);
    } catch (failure) {
      setError(messageFrom(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-auth">
      <section className="studio-auth-intro">
        <p className="eyebrow">Lærerstudio</p>
        <h1>Publiser podkaster og videoer til klassen på sekunder.</h1>
        <ul>
          <li><Headphones size={18} /> Last opp lyd og video rett fra NotebookLM</li>
          <li><BookOpen size={18} /> Organiser episodene i kapitler</li>
          <li><QrCode size={18} /> Del med klassen via QR-kode eller klassekode</li>
        </ul>
      </section>

      <section className="studio-auth-card">
        <div className="studio-mode-switch" role="tablist" aria-label="Velg innlogging eller registrering">
          <button type="button" role="tab" aria-selected={mode === "login"} aria-pressed={mode === "login"} onClick={() => { setMode("login"); setError(""); }}>Logg inn</button>
          <button type="button" role="tab" aria-selected={mode === "register"} aria-pressed={mode === "register"} onClick={() => { setMode("register"); setError(""); }}>Ny lærerkonto</button>
        </div>
        <form className="studio-form" onSubmit={submit}>
          {mode === "register" && <label>Navn<input name="name" autoComplete="name" required maxLength={80} placeholder="Fornavn Etternavn" /></label>}
          <label>E-post<input name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>
            Passord
            <input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} />
            {mode === "register" && <small>Minst 8 tegn.</small>}
          </label>
          {mode === "register" && (
            <label>
              Invitasjonskode
              <input name="invite" autoComplete="off" spellCheck={false} maxLength={200} required={IS_PRODUCTION} />
              <small>Får du av den som har satt opp Lytterom for skolen.</small>
            </label>
          )}
          {error && <p className="studio-error" role="alert">{error}</p>}
          <button className="studio-button studio-button--primary studio-button--block" disabled={busy}>
            {busy && <LoaderCircle size={16} className="studio-spinner" />}
            {mode === "login" ? "Logg inn" : "Opprett konto"}
          </button>
        </form>
      </section>
    </div>
  );
}

/* ---------- Selve studioet ---------- */

function Studio({ teacher, onLogout }: { teacher: Teacher; onLogout: () => void }) {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const loadCourses = useCallback(async () => {
    const result = await studioRequest<{ courses: CourseSummary[] }>("/api/courses?mine=1");
    setCourses(result.courses);
    return result.courses;
  }, []);

  const loadCourse = useCallback(async (id: string) => {
    const result = await studioRequest<{ course: Course }>(`/api/courses/${id}`);
    setCourse(result.course);
  }, []);

  useEffect(() => {
    loadCourses().then((list) => {
      let remembered: string | null = null;
      try { remembered = localStorage.getItem(SELECTED_KEY); } catch { /* Ingen lagring. */ }
      const first = list.find((item) => item.id === remembered) || list[0];
      if (first) setSelectedId(first.id);
    }).catch((failure) => setError(messageFrom(failure)));
  }, [loadCourses]);

  useEffect(() => {
    if (!selectedId) { setCourse(null); return; }
    try { localStorage.setItem(SELECTED_KEY, selectedId); } catch { /* Ingen lagring. */ }
    loadCourse(selectedId).catch((failure) => setError(messageFrom(failure)));
  }, [selectedId, loadCourse]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function saved(message: string, changed?: Course) {
    setDialog(null);
    setToast(message);
    const list = await loadCourses();
    if (changed && changed.id !== selectedId) { setSelectedId(changed.id); return; }
    if (selectedId && !list.some((item) => item.id === selectedId)) { setSelectedId(list[0]?.id ?? null); return; }
    if (selectedId) await loadCourse(selectedId);
  }

  async function move(endpoint: string, direction: "up" | "down") {
    try {
      await studioRequest(endpoint, studioJson("PATCH", { move: direction }));
      if (selectedId) await loadCourse(selectedId);
    } catch (failure) {
      setToast(messageFrom(failure));
    }
  }

  async function logout() {
    await studioRequest("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    onLogout();
  }

  const close = () => setDialog(null);

  return (
    <div className="studio">
      <aside className="studio-sidebar">
        <div className="studio-teacher">
          <span className="studio-avatar" aria-hidden="true">{teacher.name.slice(0, 1).toUpperCase()}</span>
          <div><strong>{teacher.name}</strong><small>{teacher.email}</small></div>
          <button className="studio-icon-button" onClick={logout} aria-label="Logg ut" title="Logg ut"><LogOut size={18} /></button>
        </div>
        <div className="studio-sidebar-head">
          <h2>Mine fagrom</h2>
          <AddButton onClick={() => setDialog({ kind: "course" })}>Nytt</AddButton>
        </div>
        {courses === null ? (
          <p className="studio-muted">Henter fagrom …</p>
        ) : courses.length ? (
          <ul className="studio-course-list">
            {courses.map((item) => (
              <li key={item.id}>
                <button aria-current={item.id === selectedId ? "true" : undefined} onClick={() => setSelectedId(item.id)} style={{ "--accent": item.accent_color } as React.CSSProperties}>
                  <span className="studio-dot" />
                  <span><strong>{item.title}</strong><small>{item.code} · {item.episode_count} episoder</small></span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="studio-muted">Du har ingen fagrom ennå.</p>
        )}
      </aside>

      <section className="studio-main">
        {error && <p className="studio-error" role="alert">{error}</p>}
        {courses?.length === 0 && (
          <div className="studio-empty">
            <BookOpen size={30} strokeWidth={1.5} />
            <h1>Lag ditt første fagrom</h1>
            <p>Et fagrom samler episodene for én klasse eller ett fag. Elevene får en klassekode og en QR-kode.</p>
            <AddButton primary onClick={() => setDialog({ kind: "course" })}>Nytt fagrom</AddButton>
          </div>
        )}

        {course && (
          <>
            <header className="studio-course-head" style={{ "--accent": course.accent_color } as React.CSSProperties}>
              <div>
                <p className="studio-course-subject">{course.subject}{course.class_label ? ` · ${course.class_label}` : ""}</p>
                <h1>{course.title}</h1>
                {course.description && <p className="studio-course-description">{course.description}</p>}
                <p className="studio-code-badge">Klassekode <strong>{course.code}</strong></p>
              </div>
              <div className="studio-course-actions">
                <button className="studio-button studio-button--primary" onClick={() => setDialog({ kind: "share" })}><QrCode size={17} /> Del med klassen</button>
                <Link className="studio-button" href={`/fag/${encodeURIComponent(course.code)}`} target="_blank"><Eye size={17} /> Se som elev</Link>
                <button className="studio-button" onClick={() => setDialog({ kind: "course", course })}><Pencil size={16} /> Rediger</button>
                <button
                  className="studio-button studio-button--ghost-danger"
                  onClick={() => setDialog({
                    kind: "delete", target: "fagrom", endpoint: `/api/courses/${course.id}`, title: course.title,
                    detail: "Alle kapitler, episoder og opplastede filer i fagrommet slettes for godt. Elevene mister tilgangen.",
                  })}
                  aria-label="Slett fagrom"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </header>

            <div className="studio-topics">
              {course.topics.map((topic, topicIndex) => (
                <section key={topic.id} className="studio-topic">
                  <header className="studio-topic-head">
                    <div>
                      <span className="studio-topic-number">Kapittel {topicIndex + 1}</span>
                      <h2>{topic.title}</h2>
                      {topic.description && <p>{topic.description}</p>}
                    </div>
                    <div className="studio-row-actions">
                      <button className="studio-icon-button" disabled={topicIndex === 0} onClick={() => move(`/api/topics/${topic.id}`, "up")} aria-label="Flytt kapittel opp"><ArrowUp size={16} /></button>
                      <button className="studio-icon-button" disabled={topicIndex === course.topics.length - 1} onClick={() => move(`/api/topics/${topic.id}`, "down")} aria-label="Flytt kapittel ned"><ArrowDown size={16} /></button>
                      <button className="studio-icon-button" onClick={() => setDialog({ kind: "topic", topic })} aria-label="Rediger kapittel"><Pencil size={16} /></button>
                      <button
                        className="studio-icon-button"
                        onClick={() => setDialog({
                          kind: "delete", target: "kapittel", endpoint: `/api/topics/${topic.id}`, title: topic.title,
                          detail: topic.episodes.length ? `Kapittelet og ${topic.episodes.length} episode(r) slettes for godt.` : "Kapittelet er tomt.",
                        })}
                        aria-label="Slett kapittel"
                      ><Trash2 size={16} /></button>
                    </div>
                  </header>

                  {topic.episodes.length > 0 && (
                    <ol className="studio-episodes">
                      {topic.episodes.map((episode, episodeIndex) => {
                        const Icon = episode.media_type === "audio" ? FileAudio : episode.media_type === "video" ? FileVideo : Youtube;
                        return (
                          <li key={episode.id} className="studio-episode">
                            <span className="studio-episode-icon"><Icon size={18} /></span>
                            <div className="studio-episode-text">
                              <strong>{episode.title}</strong>
                              <small>
                                {episode.media_type === "audio" ? "Podcast" : episode.media_type === "video" ? "Video" : "Innebygd video"}
                                {episode.duration_seconds > 0 && ` · ${durationLabel(episode.duration_seconds)}`}
                                {episode.study_notes && " · Nøkkelpunkter"}
                              </small>
                            </div>
                            <div className="studio-row-actions">
                              <button className="studio-icon-button" onClick={() => setDialog({ kind: "preview", episode })} aria-label="Testavspilling"><Headphones size={16} /></button>
                              <button className="studio-icon-button" disabled={episodeIndex === 0} onClick={() => move(`/api/episodes/${episode.id}`, "up")} aria-label="Flytt episode opp"><ArrowUp size={16} /></button>
                              <button className="studio-icon-button" disabled={episodeIndex === topic.episodes.length - 1} onClick={() => move(`/api/episodes/${episode.id}`, "down")} aria-label="Flytt episode ned"><ArrowDown size={16} /></button>
                              <button className="studio-icon-button" onClick={() => setDialog({ kind: "episode", topic, episode })} aria-label="Rediger episode"><Pencil size={16} /></button>
                              <button
                                className="studio-icon-button"
                                onClick={() => setDialog({
                                  kind: "delete", target: "episode", endpoint: `/api/episodes/${episode.id}`, title: episode.title,
                                  detail: episode.media_type === "embed" ? "Episoden fjernes fra fagrommet." : "Episoden og den opplastede filen slettes for godt.",
                                })}
                                aria-label="Slett episode"
                              ><Trash2 size={16} /></button>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  <div className="studio-topic-foot">
                    <AddButton onClick={() => setDialog({ kind: "episode", topic })}>Ny episode</AddButton>
                  </div>
                </section>
              ))}
              <button className="studio-add-topic" onClick={() => setDialog({ kind: "topic" })}>+ Nytt kapittel</button>
            </div>
          </>
        )}
      </section>

      {dialog?.kind === "course" && <CourseDialog course={dialog.course} close={close} saved={saved} />}
      {dialog?.kind === "topic" && course && <TopicDialog course={course} topic={dialog.topic} close={close} saved={saved} />}
      {dialog?.kind === "episode" && course && <EpisodeDialog course={course} topic={dialog.topic} episode={dialog.episode} close={close} saved={saved} />}
      {dialog?.kind === "share" && course && <ShareDialog course={course} close={close} />}
      {dialog?.kind === "preview" && <PreviewDialog episode={dialog.episode} close={close} />}
      {dialog?.kind === "delete" && <DeleteDialog title={dialog.title} detail={dialog.detail} kind={dialog.target} endpoint={dialog.endpoint} close={close} saved={saved} />}

      {toast && <div className="studio-toast" role="status">{toast}</div>}
    </div>
  );
}
