import { randomUUID } from "node:crypto";
import { HttpError } from "./auth";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "./limits";
import { check, MEDIA_BUCKET, publicMediaPrefix, supabase } from "./supabase";
import type { MediaType } from "./types";

/*
 * Lyd og video lagres i Supabase Storage. Læreren laster opp direkte fra nettleseren
 * med en tidsbegrenset opplastingslenke, fordi Vercel bare tar imot omtrent 4,5 MB per forespørsel.
 * Elevene strømmer filene fra bucketens offentlige adresse, som støtter spoling (Range).
 */

export { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB };

export const MEDIA_TYPES: Record<string, { mime: string; kind: Exclude<MediaType, "embed"> }> = {
  ".mp3": { mime: "audio/mpeg", kind: "audio" },
  ".m4a": { mime: "audio/mp4", kind: "audio" },
  ".wav": { mime: "audio/wav", kind: "audio" },
  ".ogg": { mime: "audio/ogg", kind: "audio" },
  ".aac": { mime: "audio/aac", kind: "audio" },
  ".flac": { mime: "audio/flac", kind: "audio" },
  ".mp4": { mime: "video/mp4", kind: "video" },
  ".webm": { mime: "video/webm", kind: "video" },
  ".mov": { mime: "video/quicktime", kind: "video" },
};

const UPLOAD_PATH = /^([a-zA-Z0-9-]{1,64})\/[a-f0-9-]{36}(\.(?:mp3|m4a|wav|ogg|aac|flac|mp4|webm|mov))$/;

function extensionOf(filename: string) {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

/** Sjekker filen og lager en opplastingslenke. Filen havner i lærerens egen mappe. */
export async function createUpload(teacherId: string, filename: string, size: number) {
  const extension = extensionOf(filename);
  const type = MEDIA_TYPES[extension];
  if (!type) throw new HttpError(415, "Filtypen støttes ikke. Bruk MP3, M4A, WAV, OGG, AAC, FLAC, MP4, WEBM eller MOV.");
  if (!(size > 0)) throw new HttpError(400, "Filen er tom.");
  if (size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `Filen er for stor. Maks størrelse er ${MAX_UPLOAD_MB} MB. Lengre videoer kan legges på YouTube og lenkes inn.`);
  }
  const path = `${teacherId}/${randomUUID()}${extension}`;
  const signed = check(await supabase().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path));
  return { upload_url: signed.signedUrl, upload_path: path, content_type: type.mime };
}

/**
 * Bekrefter at en opplastet fil finnes og tilhører læreren.
 * Returnerer den offentlige adressen og om det er lyd eller video.
 */
export async function confirmUpload(teacherId: string, path: string) {
  const match = path.match(UPLOAD_PATH);
  if (!match || match[1] !== teacherId) throw new HttpError(400, "Ugyldig opplasting.");
  const type = MEDIA_TYPES[match[2]];
  const exists = check(await supabase().storage.from(MEDIA_BUCKET).exists(path));
  if (!exists) throw new HttpError(400, "Fant ikke den opplastede filen. Prøv å laste opp på nytt.");
  return { media_url: publicMediaPrefix() + path, media_type: type.kind };
}

/** Sletter en opplastet fil. Ignorerer demo-filer og eksterne lenker. */
export async function deleteMedia(mediaUrl: string) {
  await deleteMediaFiles([mediaUrl]);
}

export async function deleteMediaFiles(urls: string[]) {
  const prefix = publicMediaPrefix();
  const paths = urls.filter((url) => url.startsWith(prefix)).map((url) => url.slice(prefix.length)).filter((path) => UPLOAD_PATH.test(path));
  if (!paths.length) return;
  const { error } = await supabase().storage.from(MEDIA_BUCKET).remove(paths);
  if (error) console.error("Kunne ikke slette mediefiler:", error.message);
}

/** Sletter en fil læreren lastet opp, men som aldri ble knyttet til en episode. Rører bare lærerens egen mappe. */
export async function discardUpload(teacherId: string, path: string) {
  const match = path.match(UPLOAD_PATH);
  if (!match || match[1] !== teacherId) return;
  await supabase().storage.from(MEDIA_BUCKET).remove([path]);
}
