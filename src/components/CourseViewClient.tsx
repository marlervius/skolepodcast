"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Headphones, Pause, Play, Search, Video, X } from "lucide-react";
import { usePlayer } from "@/context/PlayerContext";
import { ensureFollowed } from "@/lib/followed";
import { formatDuration, type Course, type Episode } from "@/lib/types";

type Filter = "all" | "audio" | "video" | "unheard";
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "audio", label: "Podcast" },
  { id: "video", label: "Video" },
  { id: "unheard", label: "Ikke lyttet" },
];

export function CourseViewClient({ course }: { course: Course }) {
  const { playEpisode, currentEpisode, isPlaying, progress, toggleCompleted, syncCourse } = usePlayer();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  // Eleven som åpner en delt lenke eller QR-kode får faget automatisk i Mine fag.
  useEffect(() => { ensureFollowed(course.code); }, [course.code]);
  // Holder «Fortsett der du slapp» i takt med det læreren har endret eller slettet.
  useEffect(() => { syncCourse(course.id, course); }, [course, syncCourse]);

  const allEpisodes = useMemo(() => course.topics.flatMap((topic) => topic.episodes), [course]);
  const completed = allEpisodes.filter((episode) => progress[episode.id]?.completed).length;

  const visibleTopics = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return course.topics.map((topic) => {
      const topicMatch = needle && `${topic.title} ${topic.description}`.toLowerCase().includes(needle);
      const episodes = topic.episodes.filter((episode) => {
        if (filter === "audio" && episode.media_type !== "audio") return false;
        if (filter === "video" && episode.media_type === "audio") return false;
        if (filter === "unheard" && progress[episode.id]?.completed) return false;
        if (!needle || topicMatch) return true;
        return `${episode.title} ${episode.description} ${episode.study_notes}`.toLowerCase().includes(needle);
      });
      return { ...topic, episodes };
    }).filter((topic) => topic.episodes.length > 0 || (!query && filter === "all"));
  }, [course.topics, query, filter, progress]);

  const anyResults = visibleTopics.some((topic) => topic.episodes.length > 0);
  const accent = { "--accent": course.accent_color } as React.CSSProperties;

  return (
    <div className="page course-view" style={accent}>
      <Link href="/" className="back-link"><ArrowLeft size={17} /> Mine fag</Link>

      <header className="course-head">
        <p className="eyebrow eyebrow--accent">{course.subject}{course.class_label ? ` · ${course.class_label}` : ""}</p>
        <h1>{course.title}</h1>
        <p className="course-teacher">{course.teacher_name}</p>
        {course.description && <p className="course-description">{course.description}</p>}
        {allEpisodes.length > 0 && (
          <div className="course-progress" aria-label={`${completed} av ${allEpisodes.length} episoder fullført`}>
            <div className="bar"><span style={{ width: `${(completed / allEpisodes.length) * 100}%` }} /></div>
            <span>{completed} av {allEpisodes.length} episoder fullført</span>
          </div>
        )}
      </header>

      <div className="course-tools">
        <label className="search">
          <Search size={18} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søk i episoder, kapitler og nøkkelpunkter" aria-label="Søk i faget" />
          {query && <button onClick={() => setQuery("")} aria-label="Tøm søk"><X size={16} /></button>}
        </label>
        <div className="chips" role="group" aria-label="Filtrer episoder">
          {filters.map((item) => (
            <button key={item.id} className="chip" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>
          ))}
        </div>
      </div>

      {!anyResults && (query || filter !== "all") && (
        <p className="no-results">Ingen episoder passer med søket eller filteret.</p>
      )}

      <div className="topics">
        {visibleTopics.map((topic) => {
          const index = course.topics.findIndex((item) => item.id === topic.id);
          return (
            <section key={topic.id} className="topic" aria-labelledby={`topic-${topic.id}`}>
              <div className="topic-head">
                <span className="topic-number">Kapittel {index + 1}</span>
                <h2 id={`topic-${topic.id}`}>{topic.title}</h2>
                {topic.description && <p>{topic.description}</p>}
              </div>
              {topic.episodes.length ? (
                <ol className="episodes">
                  {topic.episodes.map((episode) => (
                    <EpisodeRow
                      key={episode.id}
                      episode={episode}
                      active={currentEpisode?.id === episode.id}
                      playing={currentEpisode?.id === episode.id && isPlaying}
                      state={progress[episode.id]}
                      notesOpen={open === episode.id}
                      onToggleNotes={() => setOpen(open === episode.id ? null : episode.id)}
                      onPlay={() => playEpisode(episode, course)}
                      onToggleDone={() => toggleCompleted(episode.id)}
                    />
                  ))}
                </ol>
              ) : (
                <p className="topic-empty">Ingen episoder i dette kapittelet ennå.</p>
              )}
            </section>
          );
        })}
        {course.topics.length === 0 && <p className="topic-empty">Læreren har ikke publisert noe her ennå.</p>}
      </div>
    </div>
  );
}

function EpisodeRow({
  episode, active, playing, state, notesOpen, onToggleNotes, onPlay, onToggleDone,
}: {
  episode: Episode;
  active: boolean;
  playing: boolean;
  state?: { position: number; completed: boolean };
  notesOpen: boolean;
  onToggleNotes: () => void;
  onPlay: () => void;
  onToggleDone: () => void;
}) {
  const done = Boolean(state?.completed);
  const fraction = !done && state?.position && episode.duration_seconds ? Math.min(1, state.position / episode.duration_seconds) : 0;
  const kind = episode.media_type === "audio" ? "Podcast" : "Video";
  const duration = formatDuration(episode.duration_seconds);
  const remaining = fraction > 0.02 ? formatDuration(episode.duration_seconds - (state?.position || 0)) : "";

  return (
    <li className={`episode${active ? " episode--active" : ""}${done ? " episode--done" : ""}`}>
      <div className="episode-main">
        <button className="episode-play" onClick={onPlay} aria-label={playing ? `Pause ${episode.title}` : `Spill av ${episode.title}`}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <div className="episode-text">
          <h3>{episode.title}</h3>
          <p className="episode-meta">
            {episode.media_type === "audio" ? <Headphones size={13} /> : <Video size={13} />}
            <span>{kind}</span>
            {duration && <><span aria-hidden="true">·</span><span>{remaining ? `${remaining} igjen` : duration}</span></>}
            {done && <><span aria-hidden="true">·</span><span className="episode-done-label"><Check size={13} /> Fullført</span></>}
          </p>
          {episode.description && <p className="episode-description">{episode.description}</p>}
          {fraction > 0 && <div className="bar bar--thin"><span style={{ width: `${fraction * 100}%` }} /></div>}
        </div>
      </div>
      <div className="episode-actions">
        {episode.study_notes && (
          <button className="text-button" aria-expanded={notesOpen} onClick={onToggleNotes}>
            Nøkkelpunkter <ChevronDown size={15} className={notesOpen ? "rotate" : ""} />
          </button>
        )}
        <button className={`text-button${done ? " text-button--done" : ""}`} onClick={onToggleDone} aria-pressed={done}>
          <Check size={15} /> {done ? "Ferdig lyttet" : "Marker som ferdig"}
        </button>
      </div>
      {notesOpen && <div className="study-notes">{episode.study_notes}</div>}
    </li>
  );
}
