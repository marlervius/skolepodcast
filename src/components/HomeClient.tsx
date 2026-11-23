"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ChevronRight, Headphones, LoaderCircle, Pause, Play, QrCode, Smartphone, X } from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";
import { follow, readFollowed, unfollow } from "@/lib/followed";
import { normalizeCode, type CourseSummary } from "@/lib/types";

export function HomeClient() {
  const { lastPlayed, progress, playEpisode, currentEpisode, isPlaying } = usePlayer();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  useEffect(() => setCodes(readFollowed()), []);

  useEffect(() => {
    if (codes === null) return;
    if (!codes.length) { setCourses([]); setLoading(false); return; }
    let active = true;
    setLoading(true);
    fetch(`/api/courses?codes=${encodeURIComponent(codes.join(","))}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { courses: CourseSummary[] }) => { if (active) setCourses(data.courses); })
      .catch(() => { if (active) setMessage({ kind: "error", text: "Kunne ikke hente fagene dine. Sjekk nettforbindelsen." }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [codes]);

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
      const response = await fetch(`/api/courses?code=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Fant ikke fagrommet.");
      setCodes(follow(data.course.code));
      setCode("");
      setMessage({ kind: "ok", text: `${data.course.title} er lagt til i Mine fag.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Fant ikke fagrommet." });
    } finally {
      setAdding(false);
    }
  }

  function remove(courseCode: string) {
    setCodes(unfollow(courseCode));
  }

  const last = lastPlayed;
  const lastProgress = last ? progress[last.episode.id] : undefined;
  const lastFraction = last && last.episode.duration_seconds && lastProgress ? Math.min(1, lastProgress.position / last.episode.duration_seconds) : 0;
  const lastIsPlaying = last && currentEpisode?.id === last.episode.id && isPlaying;

  return (
    <div className="page home">
      <section className="home-hero">
        <p className="eyebrow">Pensum på øret</p>
        <h1>Lytt til fagene dine – på bussen, på trening eller hjemme.</h1>
        <form className="code-form" onSubmit={add}>
          <label htmlFor="class-code">Klassekode fra læreren</label>
          <div className="code-form-row">
            <input
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
          <p className="code-form-hint"><QrCode size={15} /> Har læreren vist en QR-kode? Skann den med kameraet på mobilen.</p>
          {message && <p className={message.kind === "error" ? "form-error" : "form-ok"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
        </form>
      </section>

      {last && (
        <section className="continue" aria-label="Fortsett der du slapp">
          <button
            className="continue-card"
            style={{ "--accent": last.course.accent_color } as React.CSSProperties}
            onClick={() => playEpisode(last.episode, last.course)}
          >
            <span className="continue-art">{lastIsPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</span>
            <span className="continue-text">
              <small>{lastProgress?.completed ? "Hør igjen" : "Fortsett der du slapp"}</small>
              <strong>{last.episode.title}</strong>
              <span>{last.course.title}</span>
              {lastFraction > 0 && !lastProgress?.completed && <span className="bar"><span style={{ width: `${lastFraction * 100}%` }} /></span>}
            </span>
          </button>
        </section>
      )}

      <section className="my-courses" aria-labelledby="my-courses-heading">
        <div className="section-head">
          <h2 id="my-courses-heading">Mine fag</h2>
          {courses.length > 0 && <span>{courses.length} fag</span>}
        </div>

        {loading && codes?.length ? (
          <div className="course-grid" aria-busy="true">
            {codes.slice(0, 3).map((item) => <div key={item} className="course-card course-card--skeleton" />)}
          </div>
        ) : courses.length ? (
          <ul className="course-grid">
            {courses.map((course) => (
              <li key={course.id} className="course-card" style={{ "--accent": course.accent_color } as React.CSSProperties}>
                <Link href={`/fag/${encodeURIComponent(course.code)}`} className="course-card-link">
                  <span className="course-card-subject">{course.subject}{course.class_label ? ` · ${course.class_label}` : ""}</span>
                  <strong>{course.title}</strong>
                  <span className="course-card-meta">{course.teacher_name}</span>
                  <span className="course-card-foot">
                    <span><Headphones size={14} /> {course.episode_count} {course.episode_count === 1 ? "episode" : "episoder"}</span>
                    <ChevronRight size={18} />
                  </span>
                </Link>
                <button className="course-card-remove" onClick={() => remove(course.code)} aria-label={`Fjern ${course.title} fra Mine fag`}>
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : !loading ? (
          <div className="empty">
            <Smartphone size={28} strokeWidth={1.5} />
            <h3>Ingen fag ennå</h3>
            <p>Skriv inn klassekoden fra læreren din over, eller prøv eksempelfaget.</p>
            <button className="button" disabled={adding} onClick={() => void lookup("HIST-VG3")}>Prøv eksempelfaget HIST-VG3</button>
          </div>
        ) : null}
      </section>

      <footer className="home-foot">
        <p>Lytterom lagrer ingenting om deg. Fagene og fremgangen din ligger bare på denne enheten.</p>
        <Link href="/studio">Er du lærer? Gå til lærerstudio →</Link>
      </footer>
    </div>
  );
}
