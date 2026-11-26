import { GoogleGenAI } from "@google/genai";
import { HttpError } from "./auth";

/**
 * Hjelper for Google Gemini API (manusgenerering + Gemini 3.8 TTS).
 * Leser kun GEMINI_API_KEY på serveren.
 */

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new HttpError(
      503,
      "Podcast Creator er ikke aktivert ennå. Legg inn GEMINI_API_KEY i .env.local (eller miljøvariabler på Vercel) og start på nytt.",
    );
  }
  return key;
}

export function geminiClient(apiVersion?: "v1" | "v1beta"): GoogleGenAI {
  const apiKey = getApiKey();
  return apiVersion
    ? new GoogleGenAI({ apiKey, httpOptions: { apiVersion } })
    : new GoogleGenAI({ apiKey });
}

export function isTransientGeminiError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  return (
    status === 503 ||
    status === 500 ||
    status === 504 ||
    /\b503\b|UNAVAILABLE|high demand|overloaded|temporarily unavailable/i.test(raw)
  );
}

/** Oversetter typiske feil fra Gemini API til forståelige norske feilmeldinger. */
export function mapGeminiError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const raw = error instanceof Error ? error.message : String(error);
  console.error("[gemini]", error);

  if (/API[_ ]?KEY|UNAUTHENTICATED|401|403|PERMISSION_DENIED/i.test(raw)) {
    throw new HttpError(502, "Gemini API-nøkkelen ble avvist. Sjekk at GEMINI_API_KEY er gyldig i Google AI Studio.");
  }
  if (/\b402\b|prepayment|credits are depleted|billing/i.test(raw)) {
    throw new HttpError(402, "Google AI Studio-kontoen mangler kreditt/fakturering for dette kallet. Sjekk prosjektet på ai.studio/projects.");
  }
  if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(raw)) {
    throw new HttpError(429, "Gemini API-kvoten er midlertidig nådd. Vent litt og prøv igjen.");
  }
  if (isTransientGeminiError(error)) {
    throw new HttpError(503, "Google Gemini har høy trafikk akkurat nå. Prøv igjen om noen sekunder.");
  }
  if (/SAFETY|BLOCKED|PROHIBITED/i.test(raw)) {
    throw new HttpError(422, "Innholdet ble stoppet av sikkerhetsfilteret. Prøv å omformulere teksten litt.");
  }
  throw new HttpError(502, "Kunne ikke generere fra Google Gemini akkurat nå. Prøv igjen om et øyeblikk.");
}
