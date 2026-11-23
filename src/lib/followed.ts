import { normalizeCode } from "./types";

export const FOLLOWED_KEY = "lytterom_followed_codes_v1";

export function readFollowed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(FOLLOWED_KEY) || "[]");
    return Array.isArray(value) ? value.map(normalizeCode).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function write(codes: string[]) {
  try { localStorage.setItem(FOLLOWED_KEY, JSON.stringify(codes)); } catch { /* Lagring kan være blokkert. */ }
}

/** Legger koden øverst i listen over fulgte fag. */
export function follow(code: string) {
  const normalized = normalizeCode(code);
  if (!normalized) return readFollowed();
  const next = [normalized, ...readFollowed().filter((item) => item !== normalized)];
  write(next);
  return next;
}

/** Legger til koden bakerst hvis den ikke allerede følges (brukes når eleven åpner en delt lenke). */
export function ensureFollowed(code: string) {
  const normalized = normalizeCode(code);
  const current = readFollowed();
  if (!normalized || current.includes(normalized)) return current;
  const next = [...current, normalized];
  write(next);
  return next;
}

export function unfollow(code: string) {
  const next = readFollowed().filter((item) => item !== normalizeCode(code));
  write(next);
  return next;
}
