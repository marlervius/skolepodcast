import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { courseOwner, getTeacher } from "./db";
import type { Teacher } from "./types";

export const SESSION_COOKIE = "lytterom_session";
const SESSION_DAYS = 30;
let cachedSecret: string | null = null;

/**
 * Hemmeligheten som signerer innloggingscookien. Må settes i produksjon.
 * Under utvikling lages en midlertidig nøkkel, så innloggingen varer til serveren startes på nytt.
 */
function secret() {
  if (cachedSecret) return cachedSecret;
  const configured = process.env.LYTTEROM_SECRET;
  if (configured && configured.length >= 32) return (cachedSecret = configured);
  if (process.env.NODE_ENV === "production") throw new Error("LYTTEROM_SECRET må være satt (minst 32 tegn).");
  return (cachedSecret = randomBytes(48).toString("hex"));
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(teacherId: string) {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `${teacherId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [teacherId, expires, signature] = parts;
  const expected = Buffer.from(sign(`${teacherId}.${expires}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (!(Number(expires) > Date.now())) return null;
  return teacherId;
}

export async function currentTeacher(): Promise<Teacher | null> {
  const store = await cookies();
  const id = readSessionToken(store.get(SESSION_COOKIE)?.value);
  return id ? await getTeacher(id) : null;
}

export function setSessionCookie(response: NextResponse, teacherId: string) {
  response.cookies.set(SESSION_COOKIE, createSessionToken(teacherId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

/* ---------- Begrensning av innloggingsforsøk ---------- */

const attempts = new Map<string, { count: number; reset: number }>();

/** Klientens IP-adresse slik Vercel oppgir den. */
export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "ukjent";
}

/**
 * Stopper gjentatte forsøk (f.eks. passordgjetting) fra samme nøkkel.
 * Telleren ligger i minnet til serverinstansen, så den er en bremse og ikke en garanti på Vercel.
 */
export function limitAttempts(key: string, max: number, windowMs: number) {
  const now = Date.now();
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.reset <= now) attempts.delete(k);
  const entry = attempts.get(key);
  if (!entry || entry.reset <= now) {
    attempts.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  entry.count++;
  if (entry.count > max) {
    const minutes = Math.ceil((entry.reset - now) / 60_000);
    throw new HttpError(429, `For mange forsøk. Vent ${minutes} ${minutes === 1 ? "minutt" : "minutter"} og prøv igjen.`);
  }
}

/* ---------- Felles hjelpere for API-rutene ---------- */

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireTeacher() {
  const teacher = await currentTeacher();
  if (!teacher) throw new HttpError(401, "Du må logge inn for å gjøre dette.");
  return teacher;
}

/** Sikrer at innlogget lærer eier fagrommet. */
export async function requireCourseOwner(courseId: string) {
  const teacher = await requireTeacher();
  const owner = await courseOwner(courseId);
  if (!owner) throw new HttpError(404, "Fant ikke fagrommet.");
  if (owner !== teacher.id) throw new HttpError(403, "Du har ikke tilgang til dette fagrommet.");
  return teacher;
}

/** Kjører en API-handler og gjør kjente feil om til JSON-svar. */
export async function handle(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.message, error.status);
    console.error(error);
    return jsonError("Noe gikk galt på serveren. Prøv igjen.", 500);
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    throw new HttpError(400, "Ugyldig forespørsel.");
  }
}

export function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
