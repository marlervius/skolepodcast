"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight, ChevronRight, Headphones, LoaderCircle, Pause, Play,
  Plus, QrCode, RefreshCw, RotateCcw, Smartphone, WifiOff, X,
} from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";
import {
  fetchWithTimeout, follow, readCachedSummaries, readFollowed,
  unfollow, writeCachedCourse, writeCachedSummaries,
} from "@/lib/followed";
import { formatDuration, normalizeCode, type Course, type CourseSummary } from "@/lib/types";

type UndoRemoval = {
  course: CourseSummary;
  index: number;
};

export function HomeClient() {
  const { lastPlayed, progress, playEpisode, openPlayer, currentEpisode, isPlaying, syncCourse } = usePlayer();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [code, setCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [undoItem, setUndoItem] = useState<UndoRemoval | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initialCodes = readFollowed();
    setCodes(initialCodes);
    if (initialCodes.length) {
      const cached = readCachedSummaries(initialCodes);
      if (cached.length) {
        setCourses(cached);
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  const refreshCourses = useCallback((activeCodes: string[]) => {
    if (!activeCodes.length) {
      setCourses([]);
      setOfflineNotice(false);
      setLoading(false);
      return () => undefined;
    }
    let active = true;
    setLoading((prev) => prev && courses.length === 0);
    setOfflineNotice(false);

    fetchWithTimeout(`/api/courses?codes=${encodeURIComponent(activeCodes.join(","))}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("fetch-failed"))))
      .then((data: { courses: CourseSummary[] }) => {
        if (!active) return;
        setCourses(data.courses);
        writeCachedSummaries(data.courses);
        setOfflineNotice(false);
      })
      .catch(() => {
        if (!active) return;
        const cached = readCachedSummaries(activeCodes);
        if (cached.length) {
          setCourses(cached);
          setOfflineNotice(true);
        } else {
          setMessage({ kind: "error", text: "Kunne ikke hente fagene dine. Sjekk nettforbindelsen og prøv igjen." });
          setOfflineNotice(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (codes === null) return;
    return refreshCourses(codes);
  }, [codes, refreshCourses]);

  // Oppdater «Fortsett der du slapp» med ferske data i bakgrunnen.
  const lastCourseId = lastPlayed?.course.id;
  const lastCode = lastPlayed ? normalizeCode(lastPlayed.course.code) : "";
  const lastFollowed = Boolean(lastCode && codes?.includes(lastCode));

  useEffect(() => {
    if (!lastCourseId || !lastFollowed) return;
    let active = true;
    fetchWithTimeout(`/api/courses?code=${encodeURIComponent(lastCode)}&full=1`, { cache: "no-store" })
      .then((response) => (response.status === 404 ? { course: null } : response.ok ? response.json() : Promise.reject()))
      .then((data: { course: Course | null }) => {
        if (!active) return;
        if (data.course) writeCachedCourse(data.course);
        syncCourse(lastCourseId, data.course);
      })
      .catch(() => {
        /* Uten nett beholdes kortet som det er. */
      });
    return () => {
      active = false;
    };
  }, [lastCourseId, lastCode, lastFollowed, syncCourse]);

  useEffect(() => {
    if (!undoItem) return;
    const timer = window.setTimeout(() => setUndoItem(null), 6500);
    return () => window.clearTimeout(timer);
  }, [undoItem]);

  useEffect(() => {
    if (showAddForm) {
      window.requestAnimationFrame(() => codeInputRef.current?.focus());
    }
  }, [showAddForm]);

  function add(event: FormEvent) {
    event.preventDefault();
    void lookup(code);
  }

  async function lookup(value: string) {
    const normalized = normalizeCode(value);
    if (!normalized) return;
    setAdding(true);
    setMessage(null);
    try {
      const response = await fetchWithTimeout(`/api/courses?code=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Fant ikke fagrommet.");
      const addedCourse = data.course as CourseSummary;
      const nextCodes = follow(addedCourse.code);
      const merged = [addedCourse, ...courses.filter((c) => c.id !== addedCourse.id)];
      setCourses(merged);
      writeCachedSummaries(merged);
      setCodes(nextCodes);
      setCode("");
      setShowAddForm(false);
      setMessage({ kind: "ok", text: `${addedCourse.title} er lagt til i Mine fag.` });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error && error.name !== "AbortError"
          ? error.message
          : "Kunne ikke slå opp klassekoden akkurat nå. Sjekk tilkoblingen.",
      });
    } finally {
      setAdding(false);
    }
  }

  function remove(target: CourseSummary) {
    const currentList = codes ?? [];
    const index = currentList.indexOf(normalizeCode(target.code));
    setUndoItem({ course: target, index: index >= 0 ? index : 0 });
    setCourses((prev) => prev.filter((item) => item.id !== target.id));
    setCodes(unfollow(target.code));
  }

  function undoRemove() {
    if (!undoItem) return;
    const restoredCodes = follow(undoItem.course.code, undoItem.index);
    const nextCourses = [...courses];
    const insertAt = Math.min(undoItem.index, nextCourses.length);
    if (!nextCourses.some((item) => item.id === undoItem.course.id)) {
      nextCourses.splice(insertAt, 0, undoItem.course);
    }
    setCourses(nextCourses);
    writeCachedSummaries(nextCourses);
    setCodes(restoredCodes);
    setUndoItem(null);
  }

  const hasFollowedCourses = (codes?.length ?? 0) > 0 || courses.length > 0;
  const last = lastFollowed ? lastPlayed : null;
  const lastProgress = last ? progress[last.episode.id] : undefined;
  const lastFraction =
    last && last.episode.duration_seconds && lastProgress && !lastProgress.completed
      ? Math.min(1, lastProgress.position / last.episode.duration_seconds)
      : 0;
  const lastRemaining =
    last && lastFraction > 0.02
      ? formatDuration(Math.max(0, last.episode.duration_seconds - (lastProgress?.position || 0)))
      : "";
  const lastIsPlaying = Boolean(last && currentEpisode?.id === last.episode.id && isPlaying);

  const codeFormElement = (
    <form className="code-form" onSubmit={add}>
      <div className="code-form-head">
        <label htmlFor="class-code">Legg til fag med klassekode</label>
        {hasFollowedCourses && showAddForm && (
          <button
            type="button"
            className="icon-button"
            style={{ width: 32, height: 32 }}
            onClick={() => {
              setShowAddForm(false);
              setMessage(null);
            }}
            aria-label="Lukk skjema"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="code-form-row">
        <input
          ref={codeInputRef}
          id="class-code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="F.eks. HIST-VG3"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
        />
        <button className="button button--primary" disabled={adding || !normalizeCode(code)}>
          {adding ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}
          <span>Legg til</span>
        </button>
      </div>
      <p className="code-form-hint">
        <QrCode size={15} /> Har læreren vist en QR-kode? Skann den med mobilkameraet, så legges faget til automatisk.
      </p>
      {message && (
        <p className={message.kind === "error" ? "form-error" : "form-ok"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </form>
  );

  return (
    <div className="page home">
      {!hasFollowedCourses && !loading && (
        <section className="home-hero">
          <p className="eyebrow eyebrow--accent">Pensum på øret</p>
          <h1>Lytt til fagene dine – på bussen, på trening eller hjemme.</h1>
          {codeFormElement}
        </section>
      )}

      {last && (
        <section className={`continue${hasFollowedCourses ? " continue--top" : ""}`} aria-label="Fortsett der du slapp">
          <div
            className="continue-card"
            style={{ "--accent": last.course.accent_color } as React.CSSProperties}
          >
            <button
              type="button"
              className="continue-art"
              onClick={() => playEpisode(last.episode, last.course)}
              aria-label={lastIsPlaying ? `Pause ${last.episode.title}` : `Spill av ${last.episode.title}`}
            >
              {lastIsPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </button>
            <button
              type="button"
              className="continue-body"
              onClick={() => {
                if (currentEpisode?.id === last.episode.id) openPlayer();
                else playEpisode(last.episode, last.course);
              }}
            >
              <small>
                {lastProgress?.completed
                  ? "Hør igjen"
                  : lastRemaining
                    ? `Fortsett · ${lastRemaining} igjen`
                    : "Fortsett der du slapp"}
              </small>
              <strong>{last.episode.title}</strong>
              <span>{last.course.title}</span>
              {lastFraction > 0 && (
                <span className="bar">
                  <span style={{ width: `${lastFraction * 100}%` }} />
                </span>
              )}
            </button>
          </div>
        </section>
      )}

      <section className={`my-courses${hasFollowedCourses && !last ? " my-courses--top" : ""}`} aria-labelledby="my-courses-heading">
        <div className="section-head">
          <div>
            <h2 id="my-courses-heading">Mine fag</h2>
            {courses.length > 0 && <span className="section-count">{courses.length} {courses.length === 1 ? "fag" : "fag"}</span>}
          </div>
          {hasFollowedCourses && (
            <button
              type="button"
              className="button button--compact"
              aria-expanded={showAddForm}
              onClick={() => {
                setShowAddForm((prev) => !prev);
                setMessage(null);
              }}
            >
              <Plus size={16} />
              <span>Legg til fag</span>
            </button>
          )}
        </div>

        {hasFollowedCourses && showAddForm && <div className="add-drawer">{codeFormElement}</div>}
        {hasFollowedCourses && !showAddForm && message && (
          <p className={message.kind === "error" ? "form-error" : "form-ok"} style={{ marginBottom: 14 }} role="status">
            {message.text}
          </p>
        )}

        {offlineNotice && (
          <div className="offline-banner" role="status">
            <span>
              <WifiOff size={15} aria-hidden="true" />
              {courses.length
                ? "Uten nett akkurat nå – viser sist lagrede fag."
                : "Ingen nettforbindelse. Sjekk dekningen og prøv igjen."}
            </span>
            {codes && codes.length > 0 && (
              <button type="button" className="text-button" onClick={() => refreshCourses(codes)}>
                <RefreshCw size={14} /> Prøv igjen
              </button>
            )}
          </div>
        )}

        {loading && codes?.length && courses.length === 0 ? (
          <div className="course-grid" aria-busy="true">
            {codes.slice(0, 3).map((item) => (
              <div key={item} className="course-card course-card--skeleton" />
            ))}
          </div>
        ) : courses.length ? (
          <ul className="course-grid">
            {courses.map((course) => (
              <li key={course.id} className="course-card" style={{ "--accent": course.accent_color } as React.CSSProperties}>
                <Link href={`/fag/${encodeURIComponent(course.code)}`} className="course-card-link">
                  <span className="course-card-subject">
                    {course.subject}
                    {course.class_label ? ` · ${course.class_label}` : ""}
                  </span>
                  <strong>{course.title}</strong>
                  <span className="course-card-meta">{course.teacher_name}</span>
                  <span className="course-card-foot">
                    <span>
                      <Headphones size={14} /> {course.episode_count} {course.episode_count === 1 ? "episode" : "episoder"}
                    </span>
                    <ChevronRight size={18} />
                  </span>
                </Link>
                <button
                  type="button"
                  className="course-card-remove"
                  onClick={() => remove(course)}
                  aria-label={`Fjern ${course.title} fra Mine fag`}
                  title="Fjern fra Mine fag"
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : !loading ? (
          <div className="empty">
            <Smartphone size={28} strokeWidth={1.5} />
            <h3>Ingen fag ennå</h3>
            <p>Skriv inn klassekoden fra læreren din over, eller prøv eksempelfaget med en gang.</p>
            <button type="button" className="button" disabled={adding} onClick={() => void lookup("HIST-VG3")}>
              Prøv eksempelfaget HIST-VG3
            </button>
          </div>
        ) : null}
      </section>

      {undoItem && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>«{undoItem.course.title}» ble fjernet</span>
          <button type="button" onClick={undoRemove}>
            <RotateCcw size={14} /> Angre
          </button>
        </div>
      )}

      <footer className="home-foot">
        <p>Lytterom lagrer ingenting om deg. Fagene og fremgangen din ligger bare på denne enheten.</p>
        <div className="home-foot-links">
          <Link href="/">Om Lytterom</Link>
          <span aria-hidden="true">·</span>
          <Link href="/studio">For lærere (Lærerstudio) →</Link>
          <span aria-hidden="true">·</span>
          <Link href="/personvern">Personvern</Link>
        </div>
      </footer>
    </div>
  );
}
