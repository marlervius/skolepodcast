"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Clock3, Headphones, Pause, Play, RotateCcw, RotateCw, Video } from "lucide-react";
import type { Course, Episode } from "@/lib/types";
import styles from "@/components/player/Player.module.css";

type Progress = Record<string, { position: number; completed: boolean }>;
type Selection = { episode: Episode; course: Course };
type PlayerValue = {
  playEpisode: (episode: Episode, course: Course) => void;
  currentEpisode: Episode | null;
  currentCourse: Course | null;
  isPlaying: boolean;
  progress: Progress;
  toggleCompleted: (id: string) => void;
  lastPlayed: Selection | null;
  togglePlay: () => void;
};
const PlayerContext = createContext<PlayerValue | null>(null);
const PROGRESS_KEY = "lytterom_progress_v1";
const LAST_KEY = "lytterom_last_played_v1";
const SPEED_KEY = "lytterom_speed_v1";
const rates = [0.75, 1, 1.25, 1.5, 2];
function read<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ } }
function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value); const hours = Math.floor(seconds / 3600);
  return hours ? `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function embedSource(input: string): string | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/")[1] || "";
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") id = url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] || "";
    if (/^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const match = url.pathname.match(/(?:^|\/)(\d+)(?:\/|$)/);
      if (match) return `https://player.vimeo.com/video/${match[1]}`;
    }
  } catch { /* Invalid URL. */ }
  return null;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [lastPlayed, setLastPlayed] = useState<Selection | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [hydrated, setHydrated] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [sleep, setSleep] = useState(0);
  const [error, setError] = useState("");
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const progressRef = useRef<Progress>({});
  const sleepRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const episode = selection?.episode ?? null;
  const course = selection?.course ?? null;

  useEffect(() => {
    const saved = read<Progress>(PROGRESS_KEY, {}); progressRef.current = saved && typeof saved === "object" ? saved : {}; setProgress(progressRef.current);
    setLastPlayed(read<Selection | null>(LAST_KEY, null));
    const savedSpeed = read<number>(SPEED_KEY, 1); if (rates.includes(savedSpeed)) setSpeed(savedSpeed);
    setHydrated(true);
    return () => { if (sleepRef.current) clearTimeout(sleepRef.current); };
  }, []);
  const updateProgress = useCallback((id: string, next: { position: number; completed: boolean }) => {
    const updated = { ...progressRef.current, [id]: next }; progressRef.current = updated; setProgress(updated); save(PROGRESS_KEY, updated);
  }, []);
  const toggleCompleted = useCallback((id: string) => {
    const old = progressRef.current[id] || { position: 0, completed: false };
    updateProgress(id, { ...old, completed: !old.completed });
  }, [updateProgress]);
  const playEpisode = useCallback((nextEpisode: Episode, nextCourse: Course) => {
    if (selection?.episode.id === nextEpisode.id) {
      if (nextEpisode.media_type === "embed") setExpanded(true);
      else if (mediaRef.current?.paused) void mediaRef.current.play().catch(() => setError("Kunne ikke starte avspillingen. Prøv igjen."));
      else mediaRef.current?.pause();
      return;
    }
    const next = { episode: nextEpisode, course: nextCourse }; setSelection(next); setLastPlayed(next); save(LAST_KEY, next);
    setPosition(progressRef.current[nextEpisode.id]?.position || 0); setDuration(nextEpisode.duration_seconds || 0); setError(""); setIsPlaying(false);
    setExpanded(nextEpisode.media_type !== "audio");
  }, [selection]);
  const togglePlay = useCallback(() => {
    if (episode?.media_type === "embed") { setExpanded(true); return; }
    const media = mediaRef.current; if (!media) return;
    if (media.paused) void media.play().catch(() => setError("Kunne ikke starte avspillingen. Kontroller tilkoblingen og prøv igjen.")); else media.pause();
  }, [episode]);
  useEffect(() => {
    if (!episode || episode.media_type === "embed") return;
    const media = mediaRef.current; if (!media) return;
    media.playbackRate = speed;
    void media.play().catch(() => setError("Trykk på spill av for å starte episoden."));
  // The element is replaced when the selected episode changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.id]);
  useEffect(() => { if (mediaRef.current) mediaRef.current.playbackRate = speed; if (hydrated) save(SPEED_KEY, speed); }, [speed, hydrated]);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !episode || !course || episode.media_type === "embed") return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: episode.title, artist: course.teacher_name || "Lytterom", album: course.title, artwork: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] });
    const seek = (delta: number) => { const media = mediaRef.current; if (media) media.currentTime = Math.max(0, Math.min(Number.isFinite(media.duration) ? media.duration : Infinity, media.currentTime + delta)); };
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => { void mediaRef.current?.play().catch(() => setError("Kunne ikke starte avspillingen.")); }], ["pause", () => mediaRef.current?.pause()],
      ["seekbackward", (details) => seek(-(details.seekOffset || 15))], ["seekforward", (details) => seek(details.seekOffset || 15)],
      ["seekto", (details) => { if (mediaRef.current && details.seekTime != null) mediaRef.current.currentTime = details.seekTime; }],
    ];
    actions.forEach(([action, handler]) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported on this browser. */ } });
    return () => { actions.forEach(([action]) => { try { navigator.mediaSession.setActionHandler(action, null); } catch {} }); navigator.mediaSession.metadata = null; };
  }, [episode, course]);
  useEffect(() => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused"; }, [isPlaying]);
  const startSleep = (minutes: number) => {
    if (sleepRef.current) clearTimeout(sleepRef.current); setSleep(minutes);
    if (minutes) sleepRef.current = setTimeout(() => { mediaRef.current?.pause(); setSleep(0); }, minutes * 60_000);
  };
  const mediaEvents = episode ? {
    onLoadedMetadata: () => { const media = mediaRef.current; if (!media) return; setDuration(Number.isFinite(media.duration) ? media.duration : episode.duration_seconds || 0); const stored = progressRef.current[episode.id]; if (stored?.position && !stored.completed) media.currentTime = Math.min(stored.position, Math.max(0, (media.duration || Infinity) - 1)); },
    onTimeUpdate: () => { const media = mediaRef.current; if (!media) return; setPosition(media.currentTime); const old = progressRef.current[episode.id]; updateProgress(episode.id, { position: media.currentTime, completed: old?.completed || false }); },
    onPlay: () => { setIsPlaying(true); setError(""); }, onPause: () => setIsPlaying(false),
    onEnded: () => { setIsPlaying(false); updateProgress(episode.id, { position: 0, completed: true }); },
    onError: () => { setIsPlaying(false); setError("Mediefilen kunne ikke spilles av. Kontroller tilkoblingen og prøv igjen."); },
  } : {};
  const source = episode?.media_type === "embed" ? embedSource(episode.embed_url || episode.media_url) : null;
  const skip = (seconds: number) => { const media = mediaRef.current; if (media) media.currentTime = Math.max(0, Math.min(Number.isFinite(media.duration) ? media.duration : Infinity, media.currentTime + seconds)); };
  return <PlayerContext.Provider value={{ playEpisode, currentEpisode: episode, currentCourse: course, isPlaying, progress, toggleCompleted, lastPlayed, togglePlay }}>
    {children}
    {episode && course && <>
      <div className={styles.mediaContainer} data-expanded={expanded} data-video={episode.media_type === "video"}>
        {episode.media_type === "audio" && <audio key={episode.id} ref={mediaRef as React.RefObject<HTMLAudioElement>} src={episode.media_url} preload="metadata" {...mediaEvents} />}
        {episode.media_type === "video" && <video key={episode.id} ref={mediaRef as React.RefObject<HTMLVideoElement>} src={episode.media_url} preload="metadata" controls playsInline {...mediaEvents} />}
      </div>
      {expanded && <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Avspiller">
        <div className={styles.sheet}>
          <div className={styles.sheetTop}><span>SPILLER NÅ</span><button className={styles.iconButton} onClick={() => setExpanded(false)} aria-label="Lukk fullskjermspiller"><ChevronDown size={23}/></button></div>
          {episode.media_type === "embed" ? <div className={styles.embed}>{source ? <iframe src={source} title={episode.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /> : <p>Videolenken er ugyldig eller støttes ikke.</p>}</div> : episode.media_type === "video" ? <div className={styles.videoSpace} /> : <div className={styles.cover} style={{ backgroundColor: course.accent_color || "#bd654e" }}><Headphones size={70} strokeWidth={1.2}/><span>LYTTEROM / {course.subject}</span></div>}
          <div className={styles.detail}><p>{course.title}</p><h2>{episode.title}</h2><span>{course.teacher_name}</span></div>
          {episode.media_type !== "embed" ? <>
            <div className={styles.timeline}><input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration || 0)} onChange={event => { if (mediaRef.current) mediaRef.current.currentTime = Number(event.target.value); }} aria-label="Avspillingsposisjon"/><div><span>{formatTime(position)}</span><span>{formatTime(duration)}</span></div></div>
            <div className={styles.controls}><button onClick={() => skip(-15)} aria-label="Spol 15 sekunder tilbake"><RotateCcw/><small>15</small></button><button className={styles.bigPlay} onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Spill av"}>{isPlaying ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}</button><button onClick={() => skip(15)} aria-label="Spol 15 sekunder frem"><RotateCw/><small>15</small></button></div>
            <div className={styles.settings}><label>Hastighet <select value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-label="Avspillingshastighet">{rates.map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label><label><Clock3 size={16}/> Søvntimer <select value={sleep} onChange={event => startSleep(Number(event.target.value))} aria-label="Søvntimer"><option value={0}>Av</option><option value={10}>10 min</option><option value={20}>20 min</option><option value={30}>30 min</option></select></label></div>
          </> : <p className={styles.embedHint}>Bruk videospillerens egne kontroller for avspilling og hastighet.</p>}
          <button className={styles.complete} onClick={() => toggleCompleted(episode.id)}><Check size={16}/> {progress[episode.id]?.completed ? "Markert som fullført" : "Marker som fullført"}</button>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      </div>}
      <div className={styles.mini}>
        <button className={styles.miniInfo} onClick={() => setExpanded(true)} aria-label={`Åpne avspiller: ${episode.title}`}><span className={styles.miniArt} style={{ backgroundColor: course.accent_color || "#bd654e" }}>{episode.media_type === "audio" ? <Headphones size={19}/> : <Video size={19}/>}</span><span><strong>{episode.title}</strong><small>{course.title}</small></span></button>
        {episode.media_type !== "embed" && <button className={styles.miniPlay} onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Spill av"}>{isPlaying ? <Pause fill="currentColor" size={20}/> : <Play fill="currentColor" size={20}/>}</button>}
        <div className={styles.miniProgress}><span style={{ width: `${duration ? Math.min(100, position / duration * 100) : 0}%` }}/></div>
      </div>
    </>}
  </PlayerContext.Provider>;
}
export function usePlayer() { const context = useContext(PlayerContext); if (!context) throw new Error("usePlayer må brukes innenfor PlayerProvider"); return context; }
