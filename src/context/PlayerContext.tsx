"use client";

import {
  Check, ChevronDown, Clock3, Headphones, ListMusic, LoaderCircle, Maximize2,
  Pause, Play, RefreshCw, RotateCcw, RotateCw, SkipBack, SkipForward, Video, X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { StudyNotesView } from "@/components/StudyNotesView";
import styles from "@/components/player/Player.module.css";
import { readFollowed } from "@/lib/followed";
import { PAUSE_PLAYER_EVENT } from "@/lib/media";
import { formatTimecode, normalizeCode, parseEmbedUrl, type Course, type Episode } from "@/lib/types";

export type Progress = Record<string, { position: number; completed: boolean }>;
export type Selection = { episode: Episode; course: Course };

type SleepMode = 0 | 10 | 20 | 30 | 45 | "episode";
type SideTab = "notes" | "queue";

type PlayerValue = {
  playEpisode: (episode: Episode, course: Course) => void;
  openPlayer: () => void;
  pause: () => void;
  currentEpisode: Episode | null;
  currentCourse: Course | null;
  isPlaying: boolean;
  progress: Progress;
  toggleCompleted: (id: string) => void;
  lastPlayed: Selection | null;
  togglePlay: () => void;
  /** Oppdaterer «Fortsett der du slapp» og aktivt fag med ferske data, eller fjerner kortet hvis faget/episoden er borte. */
  syncCourse: (courseId: string, course: Course | null) => void;
};

type OrderedItem = {
  episode: Episode;
  topicTitle: string;
  topicNumber: number;
};

type PlaybackCommand = {
  selection: Selection;
  autoplay: boolean;
  expandIfVideo: boolean;
  nonce: number;
};

const PlayerContext = createContext<PlayerValue | null>(null);

const PROGRESS_KEY = "lytterom_progress_v1";
const LAST_KEY = "lytterom_last_played_v1";
const SPEED_KEY = "lytterom_speed_v1";
const AUTONEXT_KEY = "lytterom_autonext_v1";

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SAVE_INTERVAL_MS = 5000;
const UI_PROGRESS_STEP_SECONDS = 15;

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Lagring kan være utilgjengelig i privat modus. */
  }
}

/** Alle episodene i faget i rekkefølge med kapittelkontekst. */
function orderedCourseItems(course: Course): OrderedItem[] {
  return [...course.topics]
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((topic, topicIdx) =>
      [...topic.episodes]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((episode) => ({
          episode,
          topicTitle: topic.title,
          topicNumber: topicIdx + 1,
        })),
    );
}

const isPlayable = (item: Episode) => item.media_type !== "embed";

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [lastPlayed, setLastPlayed] = useState<Selection | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [command, setCommand] = useState<PlaybackCommand | null>(null);

  const progressRef = useRef<Progress>({});
  const lastPlayedRef = useRef<Selection | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const lastSaveRef = useRef(0);
  const controlsRef = useRef<{ toggle: () => void; pause: () => void }>({
    toggle: () => undefined,
    pause: () => undefined,
  });

  useEffect(() => {
    const saved = readStorage<Progress>(PROGRESS_KEY, {});
    progressRef.current = saved && typeof saved === "object" ? saved : {};
    setProgress(progressRef.current);

    const remembered = readStorage<Selection | null>(LAST_KEY, null);
    lastPlayedRef.current = remembered;
    setLastPlayed(remembered);

    // Gjenopprett sist spilte episode i minispilleren (i pauset tilstand) hvis eleven fortsatt følger faget.
    if (remembered?.episode && remembered?.course) {
      const followed = readFollowed();
      if (followed.includes(normalizeCode(remembered.course.code))) {
        selectionRef.current = remembered;
        setSelection(remembered);
        setCommand({ selection: remembered, autoplay: false, expandIfVideo: false, nonce: 0 });
      }
    }
  }, []);

  /** Lagrer fremgang til localStorage og oppdaterer UI ved behov. */
  const flushProgress = useCallback((syncUi = true) => {
    lastSaveRef.current = Date.now();
    saveStorage(PROGRESS_KEY, progressRef.current);
    if (syncUi) setProgress({ ...progressRef.current });
  }, []);

  const updateProgress = useCallback(
    (id: string, next: { position: number; completed: boolean }, mode: "memory" | "disk" | "full" = "full") => {
      const prev = progressRef.current[id];
      progressRef.current = { ...progressRef.current, [id]: next };
      if (mode === "full") {
        flushProgress(true);
      } else if (mode === "disk") {
        const significantMove = !prev || prev.completed !== next.completed || Math.abs(prev.position - next.position) >= UI_PROGRESS_STEP_SECONDS;
        flushProgress(significantMove);
      }
    },
    [flushProgress],
  );

  useEffect(() => {
    const store = () => saveStorage(PROGRESS_KEY, progressRef.current);
    const hidden = () => {
      if (document.visibilityState === "hidden") store();
    };
    window.addEventListener("pagehide", store);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", store);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  const rememberLast = useCallback((next: Selection | null) => {
    lastPlayedRef.current = next;
    setLastPlayed(next);
    if (next) saveStorage(LAST_KEY, next);
    else {
      try {
        localStorage.removeItem(LAST_KEY);
      } catch {
        /* Ignorer */
      }
    }
  }, []);

  const syncCourse = useCallback(
    (courseId: string, fresh: Course | null) => {
      const last = lastPlayedRef.current;
      if (last && last.course.id === courseId) {
        const freshEpisode = fresh?.topics.flatMap((t) => t.episodes).find((item) => item.id === last.episode.id);
        rememberLast(fresh && freshEpisode ? { episode: freshEpisode, course: fresh } : null);
      }
      const active = selectionRef.current;
      if (active && active.course.id === courseId) {
        const freshActiveEp = fresh?.topics.flatMap((t) => t.episodes).find((item) => item.id === active.episode.id);
        if (fresh && freshActiveEp) {
          const updated = { episode: freshActiveEp, course: fresh };
          selectionRef.current = updated;
          setSelection(updated);
        } else if (!fresh || !freshActiveEp) {
          controlsRef.current.pause();
          selectionRef.current = null;
          setSelection(null);
          setExpanded(false);
        }
      }
    },
    [rememberLast],
  );

  const toggleCompleted = useCallback(
    (id: string) => {
      const old = progressRef.current[id] || { position: 0, completed: false };
      updateProgress(id, { ...old, completed: !old.completed }, "full");
    },
    [updateProgress],
  );

  const startSelection = useCallback(
    (nextEpisode: Episode, nextCourse: Course, autoplay: boolean, expandTarget: boolean | "preserve") => {
      const next = { episode: nextEpisode, course: nextCourse };
      selectionRef.current = next;
      setSelection(next);
      rememberLast(next);
      if (expandTarget !== "preserve") setExpanded(expandTarget);
      setCommand((prev) => ({
        selection: next,
        autoplay,
        expandIfVideo: expandTarget === true,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    },
    [rememberLast],
  );

  const playEpisode = useCallback(
    (nextEpisode: Episode, nextCourse: Course) => {
      const current = selectionRef.current;
      if (current?.episode.id === nextEpisode.id && current?.course.id === nextCourse.id) {
        if (nextEpisode.media_type === "embed") setExpanded(true);
        else controlsRef.current.toggle();
        return;
      }
      startSelection(nextEpisode, nextCourse, true, nextEpisode.media_type !== "audio");
    },
    [startSelection],
  );

  const togglePlay = useCallback(() => {
    if (selectionRef.current?.episode.media_type === "embed") {
      setExpanded(true);
      return;
    }
    controlsRef.current.toggle();
  }, []);

  const pause = useCallback(() => {
    controlsRef.current.pause();
  }, []);

  const openPlayer = useCallback(() => {
    if (selectionRef.current) setExpanded(true);
  }, []);

  const dismissPlayer = useCallback(() => {
    controlsRef.current.pause();
    flushProgress(true);
    selectionRef.current = null;
    setSelection(null);
    setExpanded(false);
  }, [flushProgress]);

  useEffect(() => {
    const onPauseRequest = () => controlsRef.current.pause();
    window.addEventListener(PAUSE_PLAYER_EVENT, onPauseRequest);
    return () => window.removeEventListener(PAUSE_PLAYER_EVENT, onPauseRequest);
  }, []);

  const episode = selection?.episode ?? null;
  const course = selection?.course ?? null;

  const value = useMemo<PlayerValue>(
    () => ({
      playEpisode,
      openPlayer,
      pause,
      currentEpisode: episode,
      currentCourse: course,
      isPlaying,
      progress,
      toggleCompleted,
      lastPlayed,
      togglePlay,
      syncCourse,
    }),
    [playEpisode, openPlayer, pause, episode, course, isPlaying, progress, toggleCompleted, lastPlayed, togglePlay, syncCourse],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {selection && (
        <PlayerSurface
          selection={selection}
          command={command}
          expanded={expanded}
          setExpanded={setExpanded}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          progress={progress}
          progressRef={progressRef}
          lastSaveRef={lastSaveRef}
          updateProgress={updateProgress}
          flushProgress={flushProgress}
          toggleCompleted={toggleCompleted}
          onSwitchEpisode={(target) => startSelection(target, selection.course, true, "preserve")}
          onDismiss={dismissPlayer}
          controlsRef={controlsRef}
        />
      )}
    </PlayerContext.Provider>
  );
}

/**
 * Isolert spiller-komponent slik at tidslinjeoppdateringer (4 ganger/sek),
 * scrubbing, buffering og søvntimer-nedtelling aldri tvinger undersidene til å re-rendre.
 */
function PlayerSurface({
  selection,
  command,
  expanded,
  setExpanded,
  isPlaying,
  setIsPlaying,
  progress,
  progressRef,
  lastSaveRef,
  updateProgress,
  flushProgress,
  toggleCompleted,
  onSwitchEpisode,
  onDismiss,
  controlsRef,
}: {
  selection: Selection;
  command: PlaybackCommand | null;
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  progress: Progress;
  progressRef: React.RefObject<Progress>;
  lastSaveRef: React.RefObject<number>;
  updateProgress: (id: string, next: { position: number; completed: boolean }, mode?: "memory" | "disk" | "full") => void;
  flushProgress: (syncUi?: boolean) => void;
  toggleCompleted: (id: string) => void;
  onSwitchEpisode: (episode: Episode) => void;
  onDismiss: () => void;
  controlsRef: React.MutableRefObject<{ toggle: () => void; pause: () => void }>;
}) {
  const pathname = usePathname();
  const { episode, course } = selection;

  const [position, setPosition] = useState(() => {
    const stored = progressRef.current[episode.id];
    return stored && !stored.completed ? stored.position : 0;
  });
  const [duration, setDuration] = useState(episode.duration_seconds || 0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState(1);
  const [autoNext, setAutoNext] = useState(true);
  const [sleepMode, setSleepMode] = useState<SleepMode>(0);
  const [sleepRemainingSec, setSleepRemainingSec] = useState(0);
  const [sideTab, setSideTab] = useState<SideTab>(episode.study_notes?.trim() ? "notes" : "queue");
  const [hydratedSettings, setHydratedSettings] = useState(false);

  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const pointerDraggingRef = useRef(false);
  const autoplayWantedRef = useRef(false);
  const speedRef = useRef(1);
  const sleepDeadlineRef = useRef<number | null>(null);
  const mediaBoxRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sheetTopRef = useRef<HTMLDivElement | null>(null);
  const videoSpotRef = useRef<HTMLDivElement | null>(null);

  const orderedItems = useMemo(() => orderedCourseItems(course), [course]);
  const playableItems = useMemo(() => orderedItems.filter((item) => isPlayable(item.episode)), [orderedItems]);

  const currentItemMeta = useMemo(
    () => orderedItems.find((item) => item.episode.id === episode.id) ?? null,
    [orderedItems, episode.id],
  );

  const { previousEpisode, nextEpisode } = useMemo(() => {
    const index = orderedItems.findIndex((item) => item.episode.id === episode.id);
    if (index < 0) return { previousEpisode: null, nextEpisode: null };
    const prev = orderedItems.slice(0, index).reverse().find((item) => isPlayable(item.episode))?.episode ?? null;
    const next = orderedItems.slice(index + 1).find((item) => isPlayable(item.episode))?.episode ?? null;
    return { previousEpisode: prev, nextEpisode: next };
  }, [orderedItems, episode.id]);

  useEffect(() => {
    const savedSpeed = readStorage<number>(SPEED_KEY, 1);
    if (RATES.includes(savedSpeed)) {
      speedRef.current = savedSpeed;
      setSpeed(savedSpeed);
    }
    const savedAutoNext = readStorage<boolean>(AUTONEXT_KEY, true);
    if (typeof savedAutoNext === "boolean") setAutoNext(savedAutoNext);
    setHydratedSettings(true);
  }, []);

  useEffect(() => {
    speedRef.current = speed;
    if (mediaRef.current) {
      mediaRef.current.defaultPlaybackRate = speed;
      mediaRef.current.playbackRate = speed;
    }
    if (hydratedSettings) saveStorage(SPEED_KEY, speed);
  }, [speed, hydratedSettings]);

  useEffect(() => {
    if (hydratedSettings) saveStorage(AUTONEXT_KEY, autoNext);
  }, [autoNext, hydratedSettings]);

  const syncMediaSessionPosition = useCallback((pos: number, dur: number, rate: number) => {
    if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setPositionState !== "function") return;
    if (!Number.isFinite(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: rate > 0 ? rate : 1,
        position: Math.max(0, Math.min(dur, pos)),
      });
    } catch {
      /* Enkelte eldre nettlesere støtter ikke setPositionState fullt ut. */
    }
  }, []);

  const attemptPlay = useCallback((userInitiated: boolean) => {
    const media = mediaRef.current;
    if (!media) return;
    setError("");
    autoplayWantedRef.current = true;
    media.defaultPlaybackRate = speedRef.current;
    media.playbackRate = speedRef.current;
    if (media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      setIsBuffering(true);
    }
    void media.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Avbrutt fordi brukeren raskt byttet episode eller pauset — ikke en feil.
        return;
      }
      setIsBuffering(false);
      setIsPlaying(false);
      autoplayWantedRef.current = false;
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError(userInitiated ? "Nettleseren blokkerte avspillingen. Prøv å trykke Spill av på nytt." : "Trykk på spill av for å starte episoden.");
      } else {
        setError("Kunne ikke starte avspillingen. Sjekk nettforbindelsen og prøv igjen.");
      }
    });
  }, [setIsPlaying]);

  const commitSeek = useCallback(
    (targetSeconds: number) => {
      const media = mediaRef.current;
      const upper = duration > 0 ? duration : Number.isFinite(media?.duration) ? media!.duration : Infinity;
      const clamped = Math.max(0, Math.min(upper, targetSeconds));
      setPosition(clamped);
      setScrubValue(clamped);

      if (!media || episode.media_type === "embed") return;

      if (media.readyState >= HTMLMediaElement.HAVE_METADATA) {
        pendingSeekRef.current = null;
        media.currentTime = clamped;
        syncMediaSessionPosition(clamped, Number.isFinite(media.duration) ? media.duration : duration, speedRef.current);
      } else {
        pendingSeekRef.current = clamped;
      }

      const old = progressRef.current[episode.id];
      updateProgress(episode.id, { position: clamped, completed: old?.completed || false }, "disk");
    },
    [duration, episode.id, episode.media_type, progressRef, syncMediaSessionPosition, updateProgress],
  );

  const skip = useCallback(
    (delta: number) => {
      const base = isScrubbingRef.current ? scrubValue : (mediaRef.current && pendingSeekRef.current === null && mediaRef.current.readyState >= HTMLMediaElement.HAVE_METADATA ? mediaRef.current.currentTime : position);
      commitSeek(base + delta);
    },
    [commitSeek, position, scrubValue],
  );

  const retryPlayback = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    setError("");
    const resumeTarget = position > 1 ? position : null;
    if (resumeTarget !== null) pendingSeekRef.current = resumeTarget;
    media.load();
    attemptPlay(true);
  }, [attemptPlay, position]);

  useEffect(() => {
    controlsRef.current = {
      toggle: () => {
        const media = mediaRef.current;
        if (!media) return;
        if (media.paused) attemptPlay(true);
        else {
          autoplayWantedRef.current = false;
          media.pause();
        }
      },
      pause: () => {
        autoplayWantedRef.current = false;
        setIsBuffering(false);
        mediaRef.current?.pause();
      },
    };
  }, [attemptPlay, controlsRef]);

  // Håndter ny valgt episode eller eksplisitt avspillingskommando
  useEffect(() => {
    if (!command) return;
    const targetEp = command.selection.episode;
    const stored = progressRef.current[targetEp.id];
    const resume = stored && !stored.completed && stored.position > 1 ? stored.position : 0;

    isScrubbingRef.current = false;
    pointerDraggingRef.current = false;
    setIsScrubbing(false);
    setPosition(resume);
    setScrubValue(resume);
    setDuration(targetEp.duration_seconds || 0);
    setError("");
    setIsBuffering(false);
    setSideTab(targetEp.study_notes?.trim() ? "notes" : "queue");

    if (targetEp.media_type === "embed") {
      pendingSeekRef.current = null;
      autoplayWantedRef.current = false;
      setIsPlaying(false);
      return;
    }

    pendingSeekRef.current = resume > 0 ? resume : null;
    autoplayWantedRef.current = command.autoplay;

    const media = mediaRef.current;
    if (!media) return;

    media.defaultPlaybackRate = speedRef.current;
    media.playbackRate = speedRef.current;

    if (media.readyState >= HTMLMediaElement.HAVE_METADATA && pendingSeekRef.current !== null) {
      const maxPos = Number.isFinite(media.duration) && media.duration > 1 ? media.duration - 1 : pendingSeekRef.current;
      media.currentTime = Math.max(0, Math.min(pendingSeekRef.current, maxPos));
      pendingSeekRef.current = null;
    }

    if (command.autoplay) {
      attemptPlay(true);
    } else {
      setIsPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.nonce, episode.id, episode.media_url]);

  // Søvntimer med levende sekund-nedtelling
  const configureSleep = useCallback((mode: SleepMode) => {
    setSleepMode(mode);
    if (typeof mode === "number" && mode > 0) {
      const deadline = Date.now() + mode * 60_000;
      sleepDeadlineRef.current = deadline;
      setSleepRemainingSec(mode * 60);
    } else {
      sleepDeadlineRef.current = null;
      setSleepRemainingSec(0);
    }
  }, []);

  useEffect(() => {
    if (typeof sleepMode !== "number" || sleepMode <= 0 || !sleepDeadlineRef.current) return;
    const interval = window.setInterval(() => {
      const deadline = sleepDeadlineRef.current;
      if (!deadline) return;
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSleepRemainingSec(remaining);
      if (remaining <= 0) {
        sleepDeadlineRef.current = null;
        setSleepMode(0);
        autoplayWantedRef.current = false;
        mediaRef.current?.pause();
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [sleepMode]);

  // Media Session API (låseskjerm, hodetelefonknapper og tidslinje)
  useEffect(() => {
    if (!("mediaSession" in navigator) || episode.media_type === "embed") return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: course.teacher_name || "Lytterom",
      album: course.title,
      artwork: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });

    const actions: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ["play", () => attemptPlay(true)],
      ["pause", () => { autoplayWantedRef.current = false; mediaRef.current?.pause(); }],
      ["seekbackward", (details) => skip(-(details.seekOffset || 15))],
      ["seekforward", (details) => skip(details.seekOffset || 15)],
      ["seekto", (details) => { if (details.seekTime != null) commitSeek(details.seekTime); }],
      ["previoustrack", previousEpisode ? () => onSwitchEpisode(previousEpisode) : null],
      ["nexttrack", nextEpisode ? () => onSwitchEpisode(nextEpisode) : null],
    ];
    actions.forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* Støttes ikke i denne nettleseren. */
      }
    });
    return () => {
      actions.forEach(([action]) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* Ignorer */
        }
      });
    };
  }, [attemptPlay, commitSeek, course.teacher_name, course.title, episode.media_type, episode.title, nextEpisode, onSwitchEpisode, previousEpisode, skip]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
    syncMediaSessionPosition(position, duration, speed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, speed, duration]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, setExpanded]);

  // Synkroniser posisjon og klipp videoelementet mot sticky toppbar ved scroll i fullskjermspilleren
  const showVideo = expanded && episode.media_type === "video";
  useLayoutEffect(() => {
    const box = mediaBoxRef.current;
    const spot = videoSpotRef.current;
    const overlay = overlayRef.current;
    if (!showVideo || !box || !spot || !overlay) return;

    const sync = () => {
      const rect = spot.getBoundingClientRect();
      const headerBottom = sheetTopRef.current?.getBoundingClientRect().bottom ?? 0;
      const clipTop = Math.max(0, headerBottom - rect.top);
      Object.assign(box.style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        clipPath: clipTop > 0 ? `inset(${clipTop}px 0 0 0)` : "none",
        pointerEvents: clipTop >= rect.height ? "none" : "auto",
      });
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(spot);
    overlay.addEventListener("scroll", sync, { passive: true });
    overlay.addEventListener("animationend", sync);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      overlay.removeEventListener("scroll", sync);
      overlay.removeEventListener("animationend", sync);
      window.removeEventListener("resize", sync);
      ["top", "left", "width", "height", "clip-path", "pointer-events"].forEach((prop) => box.style.removeProperty(prop));
    };
  }, [showVideo, episode.id]);

  const requestVideoFullscreen = () => {
    const video = mediaRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!video) return;
    if (typeof video.requestFullscreen === "function") {
      void video.requestFullscreen().catch(() => undefined);
    } else if (typeof video.webkitEnterFullscreen === "function") {
      video.webkitEnterFullscreen();
    }
  };

  const mediaEvents = {
    onLoadedMetadata: () => {
      const media = mediaRef.current;
      if (!media) return;
      media.defaultPlaybackRate = speedRef.current;
      media.playbackRate = speedRef.current;
      const realDuration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : episode.duration_seconds || 0;
      setDuration(realDuration);

      if (pendingSeekRef.current !== null) {
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        const clamped = realDuration > 1 ? Math.min(target, realDuration - 1) : target;
        media.currentTime = Math.max(0, clamped);
        setPosition(clamped);
        setScrubValue(clamped);
      }
      syncMediaSessionPosition(media.currentTime, realDuration, speedRef.current);
    },
    onTimeUpdate: () => {
      const media = mediaRef.current;
      if (!media || media.readyState < HTMLMediaElement.HAVE_METADATA) return;
      if (pendingSeekRef.current !== null || isScrubbingRef.current) return;

      const current = media.currentTime;
      setPosition(current);
      if (Number.isFinite(media.duration) && media.duration > 0 && Math.abs(media.duration - duration) > 0.5) {
        setDuration(media.duration);
      }

      const old = progressRef.current[episode.id];
      const shouldPersist = Date.now() - lastSaveRef.current > SAVE_INTERVAL_MS;
      updateProgress(
        episode.id,
        { position: current, completed: old?.completed || false },
        shouldPersist ? "disk" : "memory",
      );
    },
    onWaiting: () => {
      if (autoplayWantedRef.current || isPlaying) setIsBuffering(true);
    },
    onStalled: () => {
      if (autoplayWantedRef.current && mediaRef.current && mediaRef.current.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        setIsBuffering(true);
      }
    },
    onCanPlay: () => setIsBuffering(false),
    onPlaying: () => {
      setIsBuffering(false);
      setIsPlaying(true);
      setError("");
      if (mediaRef.current && mediaRef.current.playbackRate !== speedRef.current) {
        mediaRef.current.playbackRate = speedRef.current;
      }
    },
    onPlay: () => {
      setIsPlaying(true);
      setError("");
    },
    onPause: () => {
      setIsBuffering(false);
      setIsPlaying(false);
      if (pendingSeekRef.current === null) flushProgress(true);
    },
    onEnded: () => {
      setIsBuffering(false);
      setIsPlaying(false);
      autoplayWantedRef.current = false;
      pendingSeekRef.current = null;
      updateProgress(episode.id, { position: 0, completed: true }, "full");

      if (sleepMode === "episode") {
        setSleepMode(0);
        setPosition(0);
        return;
      }
      if (autoNext && nextEpisode) {
        onSwitchEpisode(nextEpisode);
      } else {
        setPosition(0);
      }
    },
    onError: () => {
      setIsBuffering(false);
      setIsPlaying(false);
      autoplayWantedRef.current = false;
      setError("Mediefilen kunne ikke spilles av. Kontroller nettforbindelsen og prøv igjen.");
    },
  };

  const embedSource = episode.media_type === "embed" ? parseEmbedUrl(episode.embed_url || episode.media_url) : null;
  const displayedPosition = isScrubbing ? scrubValue : position;
  const remainingTime = Math.max(0, (duration || 0) - displayedPosition);
  const completed = Boolean(progress[episode.id]?.completed);
  const accentVars = { "--accent": course.accent_color || "#C0563B" } as React.CSSProperties;

  const hasNotes = Boolean(episode.study_notes?.trim());
  const inStudio = pathname.startsWith("/studio");
  const showMini = !inStudio || isPlaying || Boolean(error);

  const sleepCountdownLabel =
    sleepMode === "episode"
      ? "Slutt av ep."
      : sleepRemainingSec > 0
        ? formatTimecode(sleepRemainingSec)
        : "";

  const queuePanel = (
    <section className={styles.panelCard} aria-label="Episodekø">
      <div className={styles.panelHead}>
        <h3>I dette faget ({playableItems.length})</h3>
        <label className={styles.autoToggle}>
          <input
            type="checkbox"
            checked={autoNext}
            onChange={(e) => setAutoNext(e.target.checked)}
          />
          <span>Spill neste automatisk</span>
        </label>
      </div>
      <ol className={styles.queueList}>
        {orderedItems.map((item, idx) => {
          const active = item.episode.id === episode.id;
          const itemDone = Boolean(progress[item.episode.id]?.completed);
          return (
            <li key={item.episode.id}>
              <button
                type="button"
                className={`${styles.queueItem}${active ? ` ${styles.queueItemActive}` : ""}`}
                onClick={() => {
                  if (!active) onSwitchEpisode(item.episode);
                }}
                aria-current={active ? "true" : undefined}
              >
                <span className={styles.queueIndex}>{idx + 1}</span>
                <span className={styles.queueText}>
                  <strong>{item.episode.title}</strong>
                  <small>
                    Kap. {item.topicNumber}: {item.topicTitle}
                    {item.episode.duration_seconds > 0 ? ` · ${formatTimecode(item.episode.duration_seconds)}` : ""}
                  </small>
                </span>
                {itemDone && <Check size={15} className={styles.queueDone} aria-label="Fullført" />}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );

  const notesPanel = (
    <section className={styles.panelCard} aria-labelledby="player-notes-heading">
      <div className={styles.panelHead}>
        <h3 id="player-notes-heading">Nøkkelpunkter</h3>
      </div>
      {hasNotes ? (
        <StudyNotesView notes={episode.study_notes} />
      ) : (
        <p className={styles.emptyNotes}>Læreren har ikke lagt til nøkkelpunkter for denne episoden.</p>
      )}
    </section>
  );

  return (
    <>
      {/* Samme medieelement holdes i live ved navigasjon og episodebytte for uavbrutt låseskjerm-avspilling på iOS. */}
      <div
        ref={mediaBoxRef}
        className={styles.mediaContainer}
        data-expanded={expanded}
        data-video={episode.media_type === "video"}
      >
        {episode.media_type === "audio" && (
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={episode.media_url}
            preload="metadata"
            {...mediaEvents}
          />
        )}
        {episode.media_type === "video" && (
          <>
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={episode.media_url}
              preload="metadata"
              playsInline
              {...mediaEvents}
            />
            {showVideo && (
              <>
                <button
                  type="button"
                  className={styles.videoTapTarget}
                  onClick={() => controlsRef.current.toggle()}
                  aria-label={isPlaying ? "Pause video" : "Spill av video"}
                />
                <button
                  type="button"
                  className={styles.videoFullscreenBtn}
                  onClick={requestVideoFullscreen}
                  aria-label="Fullskjerm video"
                  title="Fullskjerm"
                >
                  <Maximize2 size={17} />
                </button>
              </>
            )}
          </>
        )}
      </div>

      {expanded && (
        <div
          ref={overlayRef}
          className={styles.overlay}
          style={accentVars}
          role="dialog"
          aria-modal="true"
          aria-label="Avspiller"
        >
          <div className={styles.sheet}>
            <div ref={sheetTopRef} className={styles.sheetTop}>
              <div className={styles.sheetTopMeta}>
                <span>
                  {isBuffering ? "LASTER LYD …" : isPlaying ? "SPILLER NÅ" : "PAUSET"}
                  {currentItemMeta ? ` · KAPITTEL ${currentItemMeta.topicNumber}` : ""}
                </span>
              </div>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setExpanded(false)}
                aria-label="Minimer avspiller"
              >
                <ChevronDown size={22} />
              </button>
            </div>

            <div className={styles.sheetGrid}>
              <div className={styles.primaryPane}>
                {episode.media_type === "embed" ? (
                  <div className={styles.embed}>
                    {embedSource ? (
                      <iframe
                        src={embedSource}
                        title={episode.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    ) : (
                      <p>Videolenken er ugyldig eller støttes ikke.</p>
                    )}
                  </div>
                ) : episode.media_type === "video" ? (
                  <div ref={videoSpotRef} className={styles.videoSpace} />
                ) : (
                  <div className={styles.cover} style={{ backgroundColor: course.accent_color || "#C0563B" }}>
                    <div className={styles.coverTop}>
                      <span>{course.subject || "Lytterom"}</span>
                      <span className={styles.coverBadge}>{course.code}</span>
                    </div>
                    <div className={styles.coverCenter}>
                      {currentItemMeta && (
                        <span className={styles.coverTopic}>
                          Kapittel {currentItemMeta.topicNumber} · {currentItemMeta.topicTitle}
                        </span>
                      )}
                      <p className={styles.coverTitle}>{episode.title}</p>
                    </div>
                    <div className={styles.coverBottom}>
                      <span>{course.teacher_name || course.title}</span>
                      <span className={`${styles.wave}${isPlaying ? ` ${styles.wavePlaying}` : ""}`} aria-hidden="true">
                        <i /><i /><i /><i />
                      </span>
                    </div>
                  </div>
                )}

                <div className={styles.detail}>
                  <p>{course.title}</p>
                  <h2>{episode.title}</h2>
                  {course.teacher_name && <span>{course.teacher_name}</span>}
                </div>

                {episode.media_type !== "embed" ? (
                  <>
                    <div className={styles.timeline}>
                      <input
                        type="range"
                        min={0}
                        max={duration > 0 ? duration : 1}
                        step={0.1}
                        disabled={!(duration > 0)}
                        value={Math.min(displayedPosition, duration > 0 ? duration : 0)}
                        onPointerDown={() => {
                          pointerDraggingRef.current = true;
                          isScrubbingRef.current = true;
                          setIsScrubbing(true);
                          setScrubValue(position);
                        }}
                        onChange={(event) => {
                          const nextVal = Number(event.target.value);
                          if (pointerDraggingRef.current) {
                            setScrubValue(nextVal);
                          } else {
                            commitSeek(nextVal);
                          }
                        }}
                        onPointerUp={(event) => {
                          if (!pointerDraggingRef.current) return;
                          pointerDraggingRef.current = false;
                          const finalVal = Number((event.target as HTMLInputElement).value);
                          isScrubbingRef.current = false;
                          setIsScrubbing(false);
                          commitSeek(finalVal);
                        }}
                        onPointerCancel={() => {
                          pointerDraggingRef.current = false;
                          isScrubbingRef.current = false;
                          setIsScrubbing(false);
                        }}
                        aria-label="Avspillingsposisjon"
                      />
                      <div className={styles.timelineTimes}>
                        <span>{formatTimecode(displayedPosition)}</span>
                        <span>{duration > 0 ? `-${formatTimecode(remainingTime)}` : "0:00"}</span>
                      </div>
                    </div>

                    <div className={styles.controls}>
                      <button
                        type="button"
                        className={styles.track}
                        onClick={() => previousEpisode && onSwitchEpisode(previousEpisode)}
                        disabled={!previousEpisode}
                        aria-label={previousEpisode ? `Forrige episode: ${previousEpisode.title}` : "Ingen forrige episode"}
                      >
                        <SkipBack />
                      </button>
                      <button type="button" onClick={() => skip(-15)} aria-label="Spol 15 sekunder tilbake">
                        <RotateCcw />
                        <small>15</small>
                      </button>
                      <button
                        type="button"
                        className={styles.bigPlay}
                        onClick={() => controlsRef.current.toggle()}
                        aria-label={isPlaying ? "Pause" : "Spill av"}
                      >
                        {isBuffering ? (
                          <LoaderCircle className="spin" />
                        ) : isPlaying ? (
                          <Pause fill="currentColor" />
                        ) : (
                          <Play fill="currentColor" />
                        )}
                      </button>
                      <button type="button" onClick={() => skip(15)} aria-label="Spol 15 sekunder frem">
                        <RotateCw />
                        <small>15</small>
                      </button>
                      <button
                        type="button"
                        className={styles.track}
                        onClick={() => nextEpisode && onSwitchEpisode(nextEpisode)}
                        disabled={!nextEpisode}
                        aria-label={nextEpisode ? `Neste episode: ${nextEpisode.title}` : "Ingen neste episode"}
                      >
                        <SkipForward />
                      </button>
                    </div>

                    <div className={styles.settings}>
                      <label className={styles.settingPill}>
                        <span>Hastighet</span>
                        <select
                          value={speed}
                          onChange={(e) => setSpeed(Number(e.target.value))}
                          aria-label="Avspillingshastighet"
                        >
                          {RATES.map((rate) => (
                            <option key={rate} value={rate}>
                              {String(rate).replace(".", ",")}×
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.settingPill}>
                        <Clock3 size={15} aria-hidden="true" />
                        <span>Søvntimer</span>
                        <select
                          value={String(sleepMode)}
                          onChange={(e) => {
                            const val = e.target.value;
                            configureSleep(val === "episode" ? "episode" : (Number(val) as SleepMode));
                          }}
                          aria-label="Søvntimer"
                        >
                          <option value="0">Av</option>
                          <option value="10">10 min</option>
                          <option value="20">20 min</option>
                          <option value="30">30 min</option>
                          <option value="45">45 min</option>
                          <option value="episode">Slutt av episode</option>
                        </select>
                        {sleepCountdownLabel && <span className={styles.sleepBadge}>{sleepCountdownLabel}</span>}
                      </label>
                    </div>
                  </>
                ) : (
                  <p className={styles.embedHint}>Bruk videospillerens egne kontroller for avspilling og hastighet.</p>
                )}

                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={`${styles.complete}${completed ? ` ${styles.completeDone}` : ""}`}
                    onClick={() => toggleCompleted(episode.id)}
                    aria-pressed={completed}
                  >
                    <Check size={16} />
                    {completed ? "Markert som fullført" : "Marker som fullført"}
                  </button>
                </div>

                {error && (
                  <div className={styles.errorBox} role="alert">
                    <p>{error}</p>
                    {episode.media_type !== "embed" && (
                      <button type="button" className={styles.retryBtn} onClick={retryPlayback}>
                        <RefreshCw size={14} /> Prøv igjen
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.secondaryPane}>
                <div className={styles.tabs} role="tablist" aria-label="Detaljer og kø">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sideTab === "notes"}
                    onClick={() => setSideTab("notes")}
                  >
                    Nøkkelpunkter
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sideTab === "queue"}
                    onClick={() => setSideTab("queue")}
                  >
                    <ListMusic size={15} /> Episodekø ({orderedItems.length})
                  </button>
                </div>
                {sideTab === "notes" ? notesPanel : queuePanel}
              </div>
            </div>
          </div>
        </div>
      )}

      {showMini && (
        <div className={styles.miniWrap} style={accentVars}>
          {!expanded && error && (
            <div className={styles.miniError} role="alert">
              <span>{error}</span>
              <div className={styles.miniErrorActions}>
                {episode.media_type !== "embed" && (
                  <button type="button" className={styles.retryBtn} onClick={retryPlayback}>
                    <RefreshCw size={13} /> Prøv igjen
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button"
                  style={{ width: 28, height: 28 }}
                  onClick={() => setError("")}
                  aria-label="Skjul feilmelding"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          )}

          <div className={styles.mini}>
            <button
              type="button"
              className={styles.miniInfo}
              onClick={() => setExpanded(true)}
              aria-label={`Åpne avspiller: ${episode.title}`}
            >
              <span className={styles.miniArt} style={{ backgroundColor: course.accent_color || "#C0563B" }}>
                {episode.media_type === "audio" ? <Headphones size={19} /> : <Video size={19} />}
              </span>
              <span className={styles.miniText}>
                <strong>{episode.title}</strong>
                <small>
                  {course.title}
                  {duration > 0 && episode.media_type !== "embed"
                    ? ` · ${formatTimecode(displayedPosition)} / ${formatTimecode(duration)}`
                    : ""}
                </small>
              </span>
            </button>

            <div className={styles.miniControls}>
              {episode.media_type !== "embed" && (
                <>
                  <button
                    type="button"
                    className={styles.miniSecondary}
                    onClick={() => skip(-15)}
                    aria-label="Spol 15 sekunder tilbake"
                    title="Spol 15 sek tilbake"
                  >
                    <RotateCcw size={18} />
                    <small>15</small>
                  </button>
                  <button
                    type="button"
                    className={styles.miniPlay}
                    onClick={() => controlsRef.current.toggle()}
                    aria-label={isPlaying ? "Pause" : "Spill av"}
                  >
                    {isBuffering ? (
                      <LoaderCircle size={19} className="spin" />
                    ) : isPlaying ? (
                      <Pause fill="currentColor" size={19} />
                    ) : (
                      <Play fill="currentColor" size={19} />
                    )}
                  </button>
                </>
              )}
              <button
                type="button"
                className={`${styles.miniSecondary} ${styles.miniClose}`}
                onClick={onDismiss}
                aria-label="Lukk minispiller"
                title="Lukk avspiller"
              >
                <X size={17} />
              </button>
            </div>

            <div className={styles.miniProgress}>
              <span style={{ width: `${duration > 0 ? Math.min(100, (displayedPosition / duration) * 100) : 0}%` }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer må brukes innenfor PlayerProvider");
  return context;
}
