/**
 * Største filstørrelse for opplasting, fra LYTTEROM_MAX_UPLOAD_MB.
 * Supabase sin gratisplan godtar filer opptil 50 MB. Kan økes på betalt plan.
 * Leses bare på serveren. Studiosiden sender tallet videre til nettleseren.
 */
const configuredMaxMb = Number(process.env.LYTTEROM_MAX_UPLOAD_MB);
export const MAX_UPLOAD_MB = configuredMaxMb > 0 ? configuredMaxMb : 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
