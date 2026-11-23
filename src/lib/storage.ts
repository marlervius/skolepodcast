import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { dataPath } from "./data-path";
import { HttpError } from "./auth";
import type { MediaType } from "./types";

export const MAX_UPLOAD_BYTES = Number(process.env.LYTTEROM_MAX_UPLOAD_MB || 500) * 1024 * 1024;

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

export const MEDIA_FILENAME = /^[a-f0-9-]{36}\.(mp3|m4a|wav|ogg|aac|flac|mp4|webm|mov)$/;

export function uploadsDir() {
  return dataPath("uploads");
}

/** Validerer og lagrer en opplastet fil. Returnerer adressen filen strømmes fra. */
export async function saveUpload(file: File) {
  const extension = extname(file.name).toLowerCase();
  const type = MEDIA_TYPES[extension];
  if (!type) throw new HttpError(415, "Filtypen støttes ikke. Bruk MP3, M4A, WAV, OGG, AAC, FLAC, MP4, WEBM eller MOV.");
  // Nettlesere rapporterer MIME-typer ulikt, så vi godtar tom type eller riktig hovedkategori.
  if (file.type && !file.type.startsWith(`${type.kind}/`) && file.type !== "application/octet-stream") {
    throw new HttpError(415, "Filinnholdet ser ikke ut til å være lyd eller video.");
  }
  if (file.size === 0) throw new HttpError(400, "Filen er tom.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `Filen er for stor. Maks størrelse er ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);

  await mkdir(uploadsDir(), { recursive: true });
  const filename = `${randomUUID()}${extension}`;
  const target = dataPath("uploads", filename);
  try {
    await pipeline(Readable.fromWeb(file.stream() as unknown as NodeWebStream), createWriteStream(target));
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  }
  return { media_url: `/api/media/${filename}`, media_type: type.kind };
}

/** Sletter en opplastet fil. Ignorerer demo-filer og eksterne lenker. */
export async function deleteMedia(mediaUrl: string) {
  const filename = mediaUrl.startsWith("/api/media/") ? mediaUrl.slice("/api/media/".length) : "";
  if (!MEDIA_FILENAME.test(filename)) return;
  await unlink(dataPath("uploads", filename)).catch(() => undefined);
}

export async function deleteMediaFiles(urls: string[]) {
  await Promise.all(urls.map(deleteMedia));
}
