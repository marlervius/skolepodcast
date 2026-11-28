import { normalizeCode, type Course, type CourseSummary } from "./types";

export const FOLLOWED_KEY = "lytterom_followed_codes_v1";
const SUMMARIES_CACHE_KEY = "lytterom_course_summaries_v1";
const FULL_COURSES_CACHE_KEY = "lytterom_full_courses_v1";
const MAX_CACHED_FULL_COURSES = 15;

export function readFollowed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(FOLLOWED_KEY) || "[]");
    return Array.isArray(value) ? value.map(normalizeCode).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeFollowed(codes: string[]) {
  try {
    localStorage.setItem(FOLLOWED_KEY, JSON.stringify(codes));
  } catch {
    /* Lagring kan være blokkert. */
  }
}

/** Legger koden øverst i listen over fulgte fag, eller på en bestemt plass ved «Angre». */
export function follow(code: string, atIndex?: number) {
  const normalized = normalizeCode(code);
  const current = readFollowed();
  if (!normalized) return current;
  const without = current.filter((item) => item !== normalized);
  if (typeof atIndex === "number" && atIndex >= 0 && atIndex <= without.length) {
    without.splice(atIndex, 0, normalized);
    writeFollowed(without);
    return without;
  }
  const next = [normalized, ...without];
  writeFollowed(next);
  return next;
}

/** Legger til koden bakerst hvis den ikke allerede følges (brukes når eleven åpner en delt lenke). */
export function ensureFollowed(code: string) {
  const normalized = normalizeCode(code);
  const current = readFollowed();
  if (!normalized || current.includes(normalized)) return current;
  const next = [...current, normalized];
  writeFollowed(next);
  return next;
}

export function unfollow(code: string) {
  const normalized = normalizeCode(code);
  const next = readFollowed().filter((item) => item !== normalized);
  writeFollowed(next);
  removeCachedCourse(normalized);
  return next;
}

/* ---------- Lokal cache for rask oppstart og offline-bruk ---------- */

export function readCachedSummaries(codes?: string[]): CourseSummary[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SUMMARIES_CACHE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const list = raw as CourseSummary[];
    if (!codes) return list;
    const order = codes.map(normalizeCode);
    return list
      .filter((item) => order.includes(normalizeCode(item.code)))
      .sort((a, b) => order.indexOf(normalizeCode(a.code)) - order.indexOf(normalizeCode(b.code)));
  } catch {
    return [];
  }
}

export function writeCachedSummaries(courses: CourseSummary[]) {
  try {
    localStorage.setItem(SUMMARIES_CACHE_KEY, JSON.stringify(courses));
  } catch {
    /* Ignorer ved full lagring. */
  }
}

type FullCacheMap = Record<string, { updatedAt: number; course: Course }>;

function readFullCacheMap(): FullCacheMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(FULL_COURSES_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? (parsed as FullCacheMap) : {};
  } catch {
    return {};
  }
}

export function readCachedCourse(code: string): Course | null {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const map = readFullCacheMap();
  return map[normalized]?.course ?? null;
}

export function writeCachedCourse(course: Course) {
  const normalized = normalizeCode(course.code);
  if (!normalized) return;
  try {
    const map = readFullCacheMap();
    map[normalized] = { updatedAt: Date.now(), course };
    const entries = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_CACHED_FULL_COURSES);
    localStorage.setItem(FULL_COURSES_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* Ignorer ved full lagring. */
  }
}

function removeCachedCourse(normalizedCode: string) {
  if (!normalizedCode) return;
  try {
    const summaries = readCachedSummaries().filter((item) => normalizeCode(item.code) !== normalizedCode);
    localStorage.setItem(SUMMARIES_CACHE_KEY, JSON.stringify(summaries));
    const map = readFullCacheMap();
    if (normalizedCode in map) {
      delete map[normalizedCode];
      localStorage.setItem(FULL_COURSES_CACHE_KEY, JSON.stringify(map));
    }
  } catch {
    /* Ignorer */
  }
}

/** Henter med tidsavbrudd slik at svakt mobilnett ikke låser grensesnittet i det uendelige. */
export async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}
