"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Check, ChevronDown, Headphones, Maximize2,
  Pause, Play, Search, Video, WifiOff, X,
} from "lucide-react";
import { StudyNotesView } from "@/components/StudyNotesView";
import { usePlayer } from "@/context/PlayerContext";
import { ensureFollowed, readCachedCourse, writeCachedCourse } from "@/lib/followed";
import { formatDuration, type Course, type Episode } from "@/lib/types";

type Filter = "all" | "audio" | "video" | "unheard";
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "audio", label: "Podcast" },
  { id: "video", label: "Video" },
  { id: "unheard", label: "Ikke lyttet" },
];

/** Reservevisning dersom serveren ikke kunne nås ved sidelasting: viser sist lagrede utgave av faget fra enheten. */
export function CachedCourseView({ code }: { code: string }) {
  const [cached, setCached] = useState<Course | null | undefined>(undefined);

  useEffect(() => {
    setCached(readCachedCourse(code));
  }, [code]);

  if (cached === undefined) return null;
  if (!cached) {
    return (
      <div className="page">
        <div className="empty empty--page">
          <WifiOff size={28} strokeWidth={1.5} />
          <h1>Ingen nettforbindelse</h1>
          <p>Kunne ikke hente fagrommet akkurat nå, og det ligger ingen lagret kopi på denne enheten.</p>
          <Link className="button button--primary" href="/">Til Mine fag</Link>
        </div>
      </div>
    );
  }
  return <CourseViewClient course={cached} isCachedFallback />;
}

export function CourseViewClient({ course, isCachedFallback = false }: { course: Course; isCachedFallback?: boolean }) {
  const { playEpisode, openPlayer, currentEpisode, isPlaying, progress, toggleCompleted, syncCourse } = usePlayer();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openNotesId, setOpenNotesId] = useState<string | null>(null);

  useEffect(() => {
    ensureFollowed(course.code);
    if (!isCachedFallback) writeCachedCourse(course);
  }, [course, isCachedFallback]);

  useEffect(() => {
    syncCourse(course.id, course);
  }, [course, syncCourse]);

  const orderedEpisodes = useMemo(
    () =>
      [...course.topics]
        .sort((a, b) => a.sort_order - b.sort_order)
        .flatMap((topic) => [...topic.episodes].sort((a, b) => a.sort_order - b.sort_order)),
    [course.topics],
  );

  const completedCount = useMemo(
    () => orderedEpisodes.filter((episode) => progress[episode.id]?.completed).length,
    [orderedEpisodes, progress],
  );

  // Finn beste episode å foreslå i toppen: pågående i faget -> delvis lyttet -> første ufullførte -> første episode.
  const suggested = useMemo(() => {
    if (!orderedEpisodes.length) return null;
    if (currentEpisode && orderedEpisodes.some((ep) => ep.id === currentEpisode.id)) {
      return { episode: currentEpisode, mode: "active" as const };
    }
    const inProgress = orderedEpisodes.find((ep) => {
      const st = progress[ep.id];
      return st && !st.completed && st.position > 5;
    });
    if (inProgress) return { episode: inProgress, mode: "resume" as const };
    const nextUnheard = orderedEpisodes.find((ep) => !progress[ep.id]?.completed);
    if (nextUnheard) return { episode: nextUnheard, mode: completedCount > 0 ? ("next" as const) : ("start" as const) };
    return { episode: orderedEpisodes[0], mode: "replay" as const };
  }, [orderedEpisodes, currentEpisode, progress, completedCount]);

  const visibleTopics = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...course.topics]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((topic) => {
        const sortedEpisodes = [...topic.episodes].sort((a, b) => a.sort_order - b.sort_order);
        const topicMatch = Boolean(needle && `${topic.title} ${topic.description}`.toLowerCase().includes(needle));
        const episodes = sortedEpisodes.filter((episode) => {
          if (filter === "audio" && episode.media_type !== "audio") return false;
          if (filter === "video" && episode.media_type === "audio") return false;
          if (filter === "unheard" && progress[episode.id]?.completed) return false;
          if (!needle || topicMatch) return true;
          return `${episode.title} ${episode.description} ${episode.study_notes}`.toLowerCase().includes(needle);
        });
        return { ...topic, episodes, totalCount: sortedEpisodes.length, sortedAll: sortedEpisodes };
      })
      .filter((topic) => topic.episodes.length > 0 || (!query && filter === "all"));
  }, [course.topics, query, filter, progress]);

  const anyResults = visibleTopics.some((topic) => topic.episodes.length > 0);
  const accent = { "--accent": course.accent_color } as React.CSSProperties;
  const suggestedPlaying = Boolean(suggested && currentEpisode?.id === suggested.episode.id && isPlaying);

  const suggestedLabel = suggested
    ? suggested.mode === "active"
      ? suggestedPlaying
        ? `Pause: ${suggested.episode.title}`
        : `Fortsett: ${suggested.episode.title}`
      : suggested.mode === "resume"
        ? `Fortsett: ${suggested.episode.title}`
        : suggested.mode === "next"
          ? `Neste uleste: ${suggested.episode.title}`
          : suggested.mode === "replay"
            ? `Hør fra starten: ${suggested.episode.title}`
            : `Start faget: ${suggested.episode.title}`
    : "";

  return (
    <div className="page course-view" style={accent}>
      <Link href="/" className="back-link"><ArrowLeft size={17} /> Mine fag</Link>

      {isCachedFallback && (
        <div className="offline-banner" style={{ marginBottom: 18 }} role="status">
          <span><WifiOff size={15} aria-hidden="true" /> Viser lagret utgave av faget (uten nettforbindelse).</span>
        </div>
      )}

      <header className="course-head">
        <p className="eyebrow eyebrow--accent">
          {course.subject}
          {course.class_label ? ` · ${course.class_label}` : ""}
        </p>
        <h1>{course.title}</h1>
        {course.teacher_name && <p className="course-teacher">{course.teacher_name}</p>}
        {course.description && <p className="course-description">{course.description}</p>}

        {orderedEpisodes.length > 0 && (
          <div className="course-cta-row">
            {suggested && (
              <button
                type="button"
                className="button button--accent"
                onClick={() => playEpisode(suggested.episode, course)}
              >
                {suggestedPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                <span>{suggestedLabel}</span>
              </button>
            )}
            <div className="course-progress" aria-label={`${completedCount} av ${orderedEpisodes.length} episoder fullført`}>
              <div className="bar">
                <span style={{ width: `${(completedCount / orderedEpisodes.length) * 100}%` }} />
              </div>
              <span>{completedCount} av {orderedEpisodes.length} fullført</span>
            </div>
          </div>
        )}
      </header>

      {orderedEpisodes.length > 0 && (
        <div className="course-tools">
          <label className="search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Søk i episoder, kapitler og nøkkelpunkter"
              aria-label="Søk i faget"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Tøm søk">
                <X size={15} />
              </button>
            )}
          </label>
          <div className="chips" role="group" aria-label="Filtrer episoder">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                className="chip"
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!anyResults && (query || filter !== "all") && (
        <p className="no-results">Ingen episoder passer med søket eller filteret.</p>
      )}

      <div className="topics">
        {visibleTopics.map((topic) => {
          const index = course.topics.findIndex((item) => item.id === topic.id);
          const topicDoneCount = topic.sortedAll.filter((ep) => progress[ep.id]?.completed).length;
          return (
            <section key={topic.id} className="topic" aria-labelledby={`topic-${topic.id}`}>
              <div className="topic-head">
                <div className="topic-meta-row">
                  <span className="topic-number">Kapittel {index + 1}</span>
                  {topic.totalCount > 0 && (
                    <span className="topic-count">
                      {topicDoneCount > 0
                        ? `${topicDoneCount} av ${topic.totalCount} hørt`
                        : `${topic.totalCount} ${topic.totalCount === 1 ? "episode" : "episoder"}`}
                    </span>
                  )}
                </div>
                <h2 id={`topic-${topic.id}`}>{topic.title}</h2>
                {topic.description && <p>{topic.description}</p>}
              </div>
              {topic.episodes.length ? (
                <ol className="episodes">
                  {topic.episodes.map((episode) => (
                    <EpisodeRow
                      key={episode.id}
                      episode={episode}
                      course={course}
                      active={currentEpisode?.id === episode.id}
                      playing={currentEpisode?.id === episode.id && isPlaying}
                      state={progress[episode.id]}
                      notesOpen={openNotesId === episode.id}
                      onToggleNotes={setOpenNotesId}
                      onPlay={playEpisode}
                      onOpenPlayer={openPlayer}
                      onToggleDone={toggleCompleted}
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

const EpisodeRow = memo(function EpisodeRow({
  episode,
  course,
  active,
  playing,
  state,
  notesOpen,
  onToggleNotes,
  onPlay,
  onOpenPlayer,
  onToggleDone,
}: {
  episode: Episode;
  course: Course;
  active: boolean;
  playing: boolean;
  state?: { position: number; completed: boolean };
  notesOpen: boolean;
  onToggleNotes: (id: string | null) => void;
  onPlay: (episode: Episode, course: Course) => void;
  onOpenPlayer: () => void;
  onToggleDone: (id: string) => void;
}) {
  const done = Boolean(state?.completed);
  const fraction = !done && state?.position && episode.duration_seconds ? Math.min(1, state.position / episode.duration_seconds) : 0;
  const kind = episode.media_type === "audio" ? "Podcast" : episode.media_type === "embed" ? "Innebygd video" : "Video";
  const duration = formatDuration(episode.duration_seconds);
  const remaining = fraction > 0.02 ? formatDuration(episode.duration_seconds - (state?.position || 0)) : "";
  const hasNotes = Boolean(episode.study_notes?.trim());

  return (
    <li className={`episode${active ? " episode--active" : ""}${done ? " episode--done" : ""}`}>
      <div className="episode-main">
        <button
          type="button"
          className="episode-play"
          onClick={() => onPlay(episode, course)}
          aria-label={playing ? `Pause ${episode.title}` : `Spill av ${episode.title}`}
        >
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <div className="episode-text">
          <h3>
            <button
              type="button"
              className="episode-title-btn"
              onClick={() => {
                if (active) onOpenPlayer();
                else onPlay(episode, course);
              }}
            >
              {episode.title}
            </button>
          </h3>
          <p className="episode-meta">
            {episode.media_type === "audio" ? <Headphones size={13} /> : <Video size={13} />}
            <span>{kind}</span>
            {duration && (
              <>
                <span aria-hidden="true">·</span>
                <span>{remaining ? `${remaining} igjen` : duration}</span>
              </>
            )}
            {done && (
              <>
                <span aria-hidden="true">·</span>
                <span className="episode-done-label"><Check size={13} /> Fullført</span>
              </>
            )}
          </p>
          {episode.description && <p className="episode-description">{episode.description}</p>}
          {fraction > 0 && (
            <div className="bar bar--thin">
              <span style={{ width: `${fraction * 100}%` }} />
            </div>
          )}
        </div>
      </div>

      <div className="episode-actions">
        {active && (
          <button type="button" className="text-button" onClick={onOpenPlayer}>
            <Maximize2 size={14} /> Åpne avspiller
          </button>
        )}
        {hasNotes && (
          <button
            type="button"
            className="text-button"
            aria-expanded={notesOpen}
            onClick={() => onToggleNotes(notesOpen ? null : episode.id)}
          >
            Nøkkelpunkter <ChevronDown size={15} className={notesOpen ? "rotate" : ""} />
          </button>
        )}
        <button
          type="button"
          className={`text-button${done ? " text-button--done" : ""}`}
          onClick={() => onToggleDone(episode.id)}
          aria-pressed={done}
        >
          <Check size={15} /> {done ? "Ferdig lyttet" : "Marker som ferdig"}
        </button>
      </div>

      {notesOpen && hasNotes && (
        <div className="study-notes">
          <StudyNotesView notes={episode.study_notes} />
        </div>
      )}
    </li>
  );
});
