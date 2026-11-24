import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Bucket for opplastet lyd og video. Opprettes av supabase/schema.sql. */
export const MEDIA_BUCKET = "episode-media";

let client: SupabaseClient | null = null;

/**
 * Supabase-klient med service role-nøkkelen. Brukes bare på serveren: API-rutene
 * sjekker selv hvem som er logget inn, og tabellene er stengt for alle andre (RLS uten regler).
 */
export function supabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY må være satt. Se README.");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Starten på offentlige adresser til filer i mediebucketen. */
export function publicMediaPrefix() {
  return `${process.env.SUPABASE_URL?.replace(/\/$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/`;
}

/**
 * Kaster en feil hvis Supabase svarte med feil, ellers returneres dataene.
 * Lister og .single() gir alltid data uten feil. Bare .maybeSingle() kan gi null,
 * og de funksjonene oppgir selv «| null» i returtypen.
 */
export function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Supabase: ${result.error.message}`);
  return result.data as T;
}
