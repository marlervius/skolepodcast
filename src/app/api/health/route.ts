import { NextResponse } from "next/server";
import { ping } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Kalles daglig av Vercel Cron (vercel.json) så gratisprosjektet hos Supabase ikke settes på pause.
 * Ved feil vises årsaken (aldri nøkkelverdier), så oppsettet kan feilsøkes uten tilgang til loggene.
 */
export async function GET() {
  try {
    await ping();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = message.startsWith("Supabase:") || message.startsWith("SUPABASE_URL");
    console.error(error);
    const url = process.env.SUPABASE_URL || "";
    return NextResponse.json({
      ok: false,
      reason: known ? message : "Ukjent feil. Se loggene hos Vercel.",
      config: {
        SUPABASE_URL: url ? (/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url) ? "ser riktig ut" : "satt, men har feil format") : "mangler",
        SUPABASE_SERVICE_ROLE_KEY: keyKind(process.env.SUPABASE_SERVICE_ROLE_KEY),
        LYTTEROM_SECRET: (process.env.LYTTEROM_SECRET?.length ?? 0) >= 32 ? "satt" : "mangler eller for kort",
        LYTTEROM_INVITE_CODE: process.env.LYTTEROM_INVITE_CODE ? "satt" : "mangler",
      },
    }, { status: 500 });
  }
}

function keyKind(key: string | undefined) {
  if (!key) return "mangler";
  if (key.startsWith("sb_secret_")) return "hemmelig nøkkel (riktig type)";
  if (key.startsWith("sb_publishable_")) return "offentlig nøkkel (feil type)";
  if (key.startsWith("eyJ")) return "JWT-nøkkel";
  return "ukjent format";
}
