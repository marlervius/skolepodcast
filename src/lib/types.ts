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

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const minutes = Math.round(total / 60);
  if (total < 60) return `${total} sek`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} t ${minutes % 60} min`;
}
