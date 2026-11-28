export type MediaType = "audio" | "video" | "embed";

export type Teacher = {
  id: string;
  name: string;
  email: string;
  created_at?: string;
};

export type Episode = {
  id: string;
  topic_id: string;
  course_id: string;
  title: string;
  description: string;
  study_notes: string;
  media_type: MediaType;
  media_url: string;
  embed_url: string;
  duration_seconds: number;
  sort_order: number;
  created_at?: string;
};

export type Topic = {
  id: string;
  course_id: string;
  title: string;
  description: string;
  notebook_url?: string;
  sort_order: number;
  created_at?: string;
  episodes: Episode[];
};

export type CourseSummary = {
  id: string;
  teacher_id: string;
  teacher_name: string;
  title: string;
  subject: string;
  class_label: string;
  description: string;
  code: string;
  accent_color: string;
  notebook_url?: string;
  created_at?: string;
  episode_count: number;
  topic_count: number;
};

export type Course = CourseSummary & { topics: Topic[] };

export const COURSE_COLORS = [
  { name: "Terrakotta", value: "#C0563B" },
  { name: "Skoggrønn", value: "#2E6A4F" },
  { name: "Fjordblå", value: "#2B5B84" },
  { name: "Varm oker", value: "#B5791E" },
  { name: "Plomme", value: "#7D3E5E" },
  { name: "Skifer", value: "#4A5A6A" },
] as const;

export const DEFAULT_COLOR = COURSE_COLORS[0].value;

export function isCourseColor(value: unknown): value is string {
  return typeof value === "string" && COURSE_COLORS.some((color) => color.value.toLowerCase() === value.toLowerCase());
}

/** Normaliserer en klassekode: store bokstaver, bindestrek i stedet for mellomrom. */
export function normalizeCode(input: unknown) {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^A-Z0-9ÆØÅ-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

/** Gjør en YouTube- eller Vimeo-lenke om til en personvernvennlig innebyggingsadresse. */
export function parseEmbedUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/")[1] || "";
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      id = url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] || "";
    }
    if (/^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const match = url.pathname.match(/(?:^|\/)(\d{5,})(?:\/|$)/);
      if (match) return `https://player.vimeo.com/video/${match[1]}`;
    }
  } catch {
    /* Ugyldig adresse. */
  }
  return null;
}

export function toPublicCourse<T extends CourseSummary>(course: T): T {
  const clean: T = { ...course, teacher_id: "" };
  delete clean.notebook_url;
  if ("topics" in clean && Array.isArray((clean as unknown as Course).topics)) {
    (clean as unknown as Course).topics = (clean as unknown as Course).topics.map((topic) => {
      const cleanTopic = { ...topic };
      delete cleanTopic.notebook_url;
      return cleanTopic;
    });
  }
  return clean;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  if (total < 60) return `${total} sek`;
  const totalMinutes = Math.max(1, Math.round(total / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  return remMinutes > 0 ? `${hours} t ${remMinutes} min` : `${hours} t`;
}

/** Formaterer sekunder som tidskode, f.eks. «4:05» eller «1:02:03». */
export function formatTimecode(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = String(seconds % 60).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`;
  return `${minutes}:${remainder}`;
}
