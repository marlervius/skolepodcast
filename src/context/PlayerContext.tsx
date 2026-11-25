"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Clock3, Headphones, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Video } from "lucide-react";
import { parseEmbedUrl, type Course, type Episode } from "@/lib/types";
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
  /** Oppdaterer «Fortsett der du slapp» med ferske data, eller fjerner kortet hvis faget eller episoden er borte. */
  syncCourse: (courseId: string, course: Course | null) => void;
};
const PlayerContext = createContext<PlayerValue | null>(null);
const PROGRESS_KEY = "lytterom_progress_v1";
const LAST_KEY = "lytterom_last_played_v1";
const SPEED_KEY = "lytterom_speed_v1";
const rates = [0.75, 1, 1.25, 1.5, 2];
// Fremgangen lagres og vises på nytt med dette mellomrommet under avspilling, i stedet for ved hver timeupdate.
const SAVE_INTERVAL_MS = 5000;
function read<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ } }
function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value); const hours = Math.floor(seconds / 3600);
  return hours ? `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
/** Alle episodene i faget i rekkefølge: emnene etter sort_order, deretter episodene i hvert emne. */
function courseOrder(course: Course) {
  return [...course.topics].sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((topic) => [...topic.episodes].sort((a, b) => a.sort_order - b.sort_order));
}
const isPlayable = (item: Episode) => item.media_type !== "embed";
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
  const lastSaveRef = useRef(0);
  const lastPlayedRef = useRef<Selection | null>(null);
  const mediaBoxRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const videoSpotRef = useRef<HTMLDivElement | null>(null);
  const episode = selection?.episode ?? null;
  const course = selection?.course ?? null;
  // Forrige og neste lyd- eller videoepisode i faget. Innebygde videoer hoppes over, siden de spilles i sin egen spiller.
  const { previousEpisode, nextEpisode } = useMemo(() => {
    if (!episode || !course) return { previousEpisode: null, nextEpisode: null };
    const order = courseOrder(course); const index = order.findIndex((item) => item.id === episode.id);
    if (index < 0) return { previousEpisode: null, nextEpisode: null };
    return { previousEpisode: order.slice(0, index).reverse().find(isPlayable) ?? null, nextEpisode: order.slice(index + 1).find(isPlayable) ?? null };
  }, [episode, course]);

  useEffect(() => {
    const saved = read<Progress>(PROGRESS_KEY, {}); progressRef.current = saved && typeof saved === "object" ? saved : {}; setProgress(progressRef.current);
    lastPlayedRef.current = read<Selection | null>(LAST_KEY, null); setLastPlayed(lastPlayedRef.current);
    const savedSpeed = read<number>(SPEED_KEY, 1); if (rates.includes(savedSpeed)) setSpeed(savedSpeed);
    setHydrated(true);
    return () => { if (sleepRef.current) clearTimeout(sleepRef.current); };
  }, []);
  /** Lagrer fremgangen og viser den i appen. */
  const flushProgress = useCallback(() => {
    lastSaveRef.current = Date.now(); setProgress(progressRef.current); save(PROGRESS_KEY, progressRef.current);
  }, []);
  /** persist=false oppdaterer bare minnet; brukes under avspilling så appen ikke tegnes på nytt flere ganger i sekundet. */
  const updateProgress = useCallback((id: string, next: { position: number; completed: boolean }, persist = true) => {
    progressRef.current = { ...progressRef.current, [id]: next };
    if (persist) flushProgress();
  }, [flushProgress]);
  useEffect(() => {
    const store = () => save(PROGRESS_KEY, progressRef.current);
    const hidden = () => { if (document.visibilityState === "hidden") store(); };
    window.addEventListener("pagehide", store); document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", store); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  const rememberLast = useCallback((next: Selection | null) => {
    lastPlayedRef.current = next; setLastPlayed(next);
    if (next) save(LAST_KEY, next); else try { localStorage.removeItem(LAST_KEY); } catch { /* Storage may be unavailable. */ }
  }, []);
  const syncCourse = useCallback((courseId: string, fresh: Course | null) => {
    const last = lastPlayedRef.current;
    if (!last || last.course.id !== courseId) return;
    const freshEpisode = fresh?.topics.flatMap((topic) => topic.episodes).find((item) => item.id === last.episode.id);
    rememberLast(fresh && freshEpisode ? { episode: freshEpisode, course: fresh } : null);
  }, [rememberLast]);
  const toggleCompleted = useCallback((id: string) => {
    const old = progressRef.current[id] || { position: 0, completed: false };
    updateProgress(id, { ...old, completed: !old.completed });
  }, [updateProgress]);
  const select = useCallback((nextEpisode: Episode, nextCourse: Course) => {
    const next = { episode: nextEpisode, course: nextCourse }; setSelection(next); rememberLast(next);
    setPosition(progressRef.current[nextEpisode.id]?.position || 0); setDuration(nextEpisode.duration_seconds || 0); setError(""); setIsPlaying(false);
  }, [rememberLast]);
  const playEpisode = useCallback((nextEpisode: Episode, nextCourse: Course) => {
    if (selection?.episode.id === nextEpisode.id) {
      if (nextEpisode.media_type === "embed") setExpanded(true);
      else if (mediaRef.current?.paused) void mediaRef.current.play().catch(() => setError("Kunne ikke starte avspillingen. Prøv igjen."));
      else mediaRef.current?.pause();
      return;
    }
    select(nextEpisode, nextCourse); setExpanded(nextEpisode.media_type !== "audio");
  }, [selection, select]);
  /** Bytter til en annen episode i samme fag uten å åpne eller lukke fullskjermspilleren. */
  const goTo = useCallback((target: Episode | null) => { if (target && course) select(target, course); }, [course, select]);
  const togglePlay = useCallback(() => {
    if (episode?.media_type === "embed") { setExpanded(true); return; }
    const media = mediaRef.current; if (!media) return;
    if (media.paused) void media.play().catch(() => setError("Kunne ikke starte avspillingen. Kontroller tilkoblingen og prøv igjen.")); else media.pause();
  }, [episode]);
  useEffect(() => {
    if (!episode || episode.media_type === "embed") return;
    const media = mediaRef.current; if (!media) return;
    media.defaultPlaybackRate = speed; media.playbackRate = speed;
    void media.play().catch(() => setError("Trykk på spill av for å starte episoden."));
  // The element is replaced when the selected episode changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.id]);
  useEffect(() => { if (mediaRef.current) mediaRef.current.playbackRate = speed; if (hydrated) save(SPEED_KEY, speed); }, [speed, hydrated]);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !episode || !course || episode.media_type === "embed") return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: episode.title, artist: course.teacher_name || "Lytterom", album: course.title, artwork: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] });
    const seek = (delta: number) => { const media = mediaRef.current; if (media) media.currentTime = Math.max(0, Math.min(Number.isFinite(media.duration) ? media.duration : Infinity, media.currentTime + delta)); };
    const actions: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ["play", () => { void mediaRef.current?.play().catch(() => setError("Kunne ikke starte avspillingen.")); }], ["pause", () => mediaRef.current?.pause()],
      ["seekbackward", (details) => seek(-(details.seekOffset || 15))], ["seekforward", (details) => seek(details.seekOffset || 15)],
      ["seekto", (details) => { if (mediaRef.current && details.seekTime != null) mediaRef.current.currentTime = details.seekTime; }],
      // Knappene vises bare på låseskjermen når det finnes en episode å gå til.
      ["previoustrack", previousEpisode ? () => goTo(previousEpisode) : null], ["nexttrack", nextEpisode ? () => goTo(nextEpisode) : null],
    ];
    actions.forEach(([action, handler]) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported on this browser. */ } });
    return () => { actions.forEach(([action]) => { try { navigator.mediaSession.setActionHandler(action, null); } catch {} }); navigator.mediaSession.metadata = null; };
  }, [episode, course, previousEpisode, nextEpisode, goTo]);
  useEffect(() => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused"; }, [isPlaying]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);
  // Videoelementet ligger utenfor arket (så avspillingen ikke avbrytes), men legges oppå plassholderen og følger den når arket scrolles.
  const showVideo = expanded && episode?.media_type === "video";
  useLayoutEffect(() => {
    const box = mediaBoxRef.current, spot = videoSpotRef.current, overlay = overlayRef.current;
    if (!showVideo || !box || !spot || !overlay) return;
    const sync = () => {
      const rect = spot.getBoundingClientRect();
      Object.assign(box.style, { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    };
    sync();
    const observer = new ResizeObserver(sync); observer.observe(spot);
    overlay.addEventListener("scroll", sync, { passive: true }); overlay.addEventListener("animationend", sync); window.addEventListener("resize", sync);
    return () => {
      observer.disconnect(); overlay.removeEventListener("scroll", sync); overlay.removeEventListener("animationend", sync); window.removeEventListener("resize", sync);
      ["top", "left", "width", "height"].forEach((property) => box.style.removeProperty(property));
    };
  }, [showVideo, episode?.id]);
  const startSleep = (minutes: number) => {
    if (sleepRef.current) clearTimeout(sleepRef.current); setSleep(minutes);
    if (minutes) sleepRef.current = setTimeout(() => { mediaRef.current?.pause(); setSleep(0); }, minutes * 60_000);
  };
  const mediaEvents = episode ? {
    onLoadedMetadata: () => { const media = mediaRef.current; if (!media) return; setDuration(Number.isFinite(media.duration) ? media.duration : episode.duration_seconds || 0); const stored = progressRef.current[episode.id]; if (stored?.position && !stored.completed) media.currentTime = Math.min(stored.position, Math.max(0, (media.duration || Infinity) - 1)); },
    // Ved bytte av episode nullstilles det gjenbrukte elementet før den nye filen er lastet; den hendelsen skal ikke overskrive lagret posisjon.
    onTimeUpdate: () => { const media = mediaRef.current; if (!media || media.readyState < HTMLMediaElement.HAVE_METADATA) return; setPosition(media.currentTime); const old = progressRef.current[episode.id]; updateProgress(episode.id, { position: media.currentTime, completed: old?.completed || false }, Date.now() - lastSaveRef.current > SAVE_INTERVAL_MS); },
    onPlay: () => { setIsPlaying(true); setError(""); }, onPause: () => { setIsPlaying(false); flushProgress(); },
    // Fortsetter automatisk med neste episode i faget, og stopper etter den siste.
    onEnded: () => { setIsPlaying(false); updateProgress(episode.id, { position: 0, completed: true }); goTo(nextEpisode); },
    onError: () => { setIsPlaying(false); setError("Mediefilen kunne ikke spilles av. Kontroller tilkoblingen og prøv igjen."); },
  } : {};
  const source = episode?.media_type === "embed" ? parseEmbedUrl(episode.embed_url || episode.media_url) : null;
  const skip = (seconds: number) => { const media = mediaRef.current; if (media) media.currentTime = Math.max(0, Math.min(Number.isFinite(media.duration) ? media.duration : Infinity, media.currentTime + seconds)); };
  // Verdien er memoisert, så sidene ikke tegnes på nytt hver gang avspillingsposisjonen endres.
  const value = useMemo<PlayerValue>(() => ({ playEpisode, currentEpisode: episode, currentCourse: course, isPlaying, progress, toggleCompleted, lastPlayed, togglePlay, syncCourse }),
    [playEpisode, episode, course, isPlaying, progress, toggleCompleted, lastPlayed, togglePlay, syncCourse]);
  return <PlayerContext.Provider value={value}>
    {children}
    {episode && course && <>
      {/* Samme element gjenbrukes når episoden byttes, så iOS lar neste episode starte selv om skjermen er låst. */}
      <div ref={mediaBoxRef} className={styles.mediaContainer} data-expanded={expanded} data-video={episode.media_type === "video"}>
        {episode.media_type === "audio" && <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={episode.media_url} preload="metadata" {...mediaEvents} />}
        {episode.media_type === "video" && <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={episode.media_url} preload="metadata" controls playsInline {...mediaEvents} />}
      </div>
      {expanded && <div ref={overlayRef} className={styles.overlay} role="dialog" aria-modal="true" aria-label="Avspiller">
        <div className={styles.sheet}>
          <div className={styles.sheetTop}><span>SPILLER NÅ</span><button className={styles.iconButton} onClick={() => setExpanded(false)} aria-label="Lukk fullskjermspiller"><ChevronDown size={23}/></button></div>
          {episode.media_type === "embed" ? <div className={styles.embed}>{source ? <iframe src={source} title={episode.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /> : <p>Videolenken er ugyldig eller støttes ikke.</p>}</div> : episode.media_type === "video" ? <div ref={videoSpotRef} className={styles.videoSpace} /> : <div className={styles.cover} style={{ backgroundColor: course.accent_color || "#bd654e" }}><Headphones size={70} strokeWidth={1.2}/><span>LYTTEROM / {course.subject}</span></div>}
          <div className={styles.detail}><p>{course.title}</p><h2>{episode.title}</h2><span>{course.teacher_name}</span></div>
          {episode.media_type !== "embed" ? <>
            <div className={styles.timeline}><input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration || 0)} onChange={event => { if (mediaRef.current) mediaRef.current.currentTime = Number(event.target.value); }} aria-label="Avspillingsposisjon"/><div><span>{formatTime(position)}</span><span>{formatTime(duration)}</span></div></div>
            <div className={styles.controls}><button className={styles.track} onClick={() => goTo(previousEpisode)} disabled={!previousEpisode} aria-label={previousEpisode ? `Forrige episode: ${previousEpisode.title}` : "Ingen forrige episode"}><SkipBack/></button><button onClick={() => skip(-15)} aria-label="Spol 15 sekunder tilbake"><RotateCcw/><small>15</small></button><button className={styles.bigPlay} onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Spill av"}>{isPlaying ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}</button><button onClick={() => skip(15)} aria-label="Spol 15 sekunder frem"><RotateCw/><small>15</small></button><button className={styles.track} onClick={() => goTo(nextEpisode)} disabled={!nextEpisode} aria-label={nextEpisode ? `Neste episode: ${nextEpisode.title}` : "Ingen neste episode"}><SkipForward/></button></div>
            <p className={styles.upNext}>{nextEpisode ? <>Neste: {nextEpisode.title}</> : "Dette er siste episode i faget."}</p>
            <div className={styles.settings}><label>Hastighet <select value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-label="Avspillingshastighet">{rates.map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label><label><Clock3 size={16}/> Søvntimer <select value={sleep} onChange={event => startSleep(Number(event.target.value))} aria-label="Søvntimer"><option value={0}>Av</option><option value={10}>10 min</option><option value={20}>20 min</option><option value={30}>30 min</option></select></label></div>
          </> : <p className={styles.embedHint}>Bruk videospillerens egne kontroller for avspilling og hastighet.</p>}
          <button className={styles.complete} onClick={() => toggleCompleted(episode.id)}><Check size={16}/> {progress[episode.id]?.completed ? "Markert som fullført" : "Marker som fullført"}</button>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {episode.study_notes?.trim() && <section className={styles.notes} aria-labelledby="player-notes"><h3 id="player-notes">Nøkkelpunkter</h3><p>{episode.study_notes.trim()}</p></section>}
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
